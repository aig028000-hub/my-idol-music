const express = require("express");
const axios = require("axios");
const FormData = require("form-data");

const app = express();

app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;

// ------------------------------------------------------------
// REQUIRED ENVIRONMENT VARIABLES ON RENDER
//
// HF_TOKEN
// HF_ENDPOINT_URL
//
// ROBLOX_API_KEY
// ROBLOX_CREATOR_USER_ID
// ------------------------------------------------------------

const HF_TOKEN = process.env.HF_TOKEN;
const HF_ENDPOINT_URL = process.env.HF_ENDPOINT_URL;

const ROBLOX_API_KEY = process.env.ROBLOX_API_KEY;
const ROBLOX_CREATOR_USER_ID = process.env.ROBLOX_CREATOR_USER_ID;

if (!HF_TOKEN) {
	console.warn("WARNING: HF_TOKEN is missing.");
}

if (!HF_ENDPOINT_URL) {
	console.warn("WARNING: HF_ENDPOINT_URL is missing.");
}

if (!ROBLOX_API_KEY) {
	console.warn("WARNING: ROBLOX_API_KEY is missing.");
}

if (!ROBLOX_CREATOR_USER_ID) {
	console.warn("WARNING: ROBLOX_CREATOR_USER_ID is missing.");
}

// ------------------------------------------------------------
// BASIC TEST ROUTE
// ------------------------------------------------------------

app.get("/", (req, res) => {
	res.json({
		success: true,
		service: "AI Idol Music Engine",
		status: "online"
	});
});

// ------------------------------------------------------------
// GENERATE MUSIC
// ------------------------------------------------------------

app.post("/generate", async (req, res) => {
	try {
		const prompt = String(req.body?.prompt || "").trim();

		if (!prompt) {
			return res.status(400).json({
				success: false,
				error: "Missing prompt."
			});
		}

		if (!HF_ENDPOINT_URL || !HF_TOKEN) {
			return res.status(500).json({
				success: false,
				error: "Hugging Face configuration is missing on Render."
			});
		}

		if (!ROBLOX_API_KEY || !ROBLOX_CREATOR_USER_ID) {
			return res.status(500).json({
				success: false,
				error: "Roblox Open Cloud configuration is missing on Render."
			});
		}

		console.log("----------------------------------------");
		console.log("🎵 NEW MUSIC REQUEST");
		console.log("Prompt:", prompt);
		console.log("----------------------------------------");

		// --------------------------------------------------------
		// 1. ASK HUGGING FACE INFERENCE ENDPOINT TO GENERATE MUSIC
		// --------------------------------------------------------

		console.log("🧠 Sending prompt to Hugging Face...");

		const hfResponse = await axios.post(
			HF_ENDPOINT_URL,
			{
				inputs: prompt
			},
			{
				headers: {
					Authorization: `Bearer ${HF_TOKEN}`,
					"Content-Type": "application/json"
				},

				// Music generation can take a while.
				timeout: 180000,

				// We want the actual generated audio bytes.
				responseType: "arraybuffer",

				maxContentLength: Infinity,
				maxBodyLength: Infinity
			}
		);

		const audioBuffer = Buffer.from(hfResponse.data);

		if (!audioBuffer.length) {
			throw new Error("Hugging Face returned an empty audio file.");
		}

		const returnedContentType =
			String(hfResponse.headers["content-type"] || "")
				.toLowerCase()
				.split(";")[0];

		console.log(
			"✅ Music generated:",
			audioBuffer.length,
			"bytes"
		);

		console.log(
			"Audio type:",
			returnedContentType || "unknown"
		);

		// --------------------------------------------------------
		// 2. DETERMINE AUDIO TYPE
		// --------------------------------------------------------

		let contentType = returnedContentType;
		let filename = "concert_audio";

		if (contentType === "audio/wav" || contentType === "audio/x-wav") {
			contentType = "audio/wav";
			filename += ".wav";
		} else if (
			contentType === "audio/ogg" ||
			contentType === "application/ogg"
		) {
			contentType = "audio/ogg";
			filename += ".ogg";
		} else if (
			contentType === "audio/flac"
		) {
			contentType = "audio/flac";
			filename += ".flac";
		} else {
			// Default to MP3 if the endpoint doesn't provide
			// a useful content type.
			contentType = "audio/mpeg";
			filename += ".mp3";
		}

		// --------------------------------------------------------
		// 3. UPLOAD AUDIO TO ROBLOX OPEN CLOUD
		// --------------------------------------------------------

		console.log("☁️ Uploading generated music to Roblox...");

		const form = new FormData();

		const createRequest = {
			assetType: "Audio",

			displayName:
				"AI Concert - " +
				new Date().toISOString().replace(/[:.]/g, "-"),

			description:
				"AI-generated concert music",

			creationContext: {
				creator: {
					userId: String(ROBLOX_CREATOR_USER_ID)
				}
			}
		};

		form.append(
			"request",
			JSON.stringify(createRequest)
		);

		form.append(
			"fileContent",
			audioBuffer,
			{
				filename,
				contentType
			}
		);

		const createResponse = await axios.post(
			"https://apis.roblox.com/assets/v1/assets",
			form,
			{
				headers: {
					"x-api-key": ROBLOX_API_KEY,
					...form.getHeaders()
				},

				timeout: 120000,

				maxContentLength: Infinity,
				maxBodyLength: Infinity
			}
		);

		const operation = createResponse.data;

		console.log(
			"Roblox operation:",
			JSON.stringify(operation)
		);

		// --------------------------------------------------------
		// 4. WAIT FOR ROBLOX ASSET CREATION
		// --------------------------------------------------------

		if (!operation.path) {
			throw new Error(
				"Roblox did not return an operation path."
			);
		}

		const operationId =
			operation.path.split("/").pop();

		console.log(
			"⏳ Waiting for Roblox asset operation:",
			operationId
		);

		let result = null;

		for (let attempt = 0; attempt < 60; attempt++) {
			const operationResponse = await axios.get(
				`https://apis.roblox.com/assets/v1/operations/${operationId}`,
				{
					headers: {
						"x-api-key": ROBLOX_API_KEY
					},
					timeout: 30000
				}
			);

			result = operationResponse.data;

			console.log(
				`Roblox operation check ${attempt + 1}:`,
				result.done
			);

			if (result.done) {
				break;
			}

			await new Promise(resolve =>
				setTimeout(resolve, 3000)
			);
		}

		if (!result || !result.done) {
			throw new Error(
				"Roblox asset creation timed out."
			);
		}

		// --------------------------------------------------------
		// 5. CHECK ROBLOX RESPONSE
		// --------------------------------------------------------

		if (result.error) {
			console.error(
				"Roblox asset error:",
				result.error
			);

			throw new Error(
				result.error.message ||
				"Roblox rejected the asset."
			);
		}

		const asset = result.response;

		if (!asset || !asset.assetId) {
			console.error(
				"Unexpected Roblox result:",
				JSON.stringify(result)
			);

			throw new Error(
				"Roblox did not return an audio asset ID."
			);
		}

		const assetId = String(asset.assetId);

		console.log("----------------------------------------");
		console.log("🎉 CONCERT AUDIO READY");
		console.log("Roblox Asset ID:", assetId);
		console.log("----------------------------------------");

		return res.json({
			success: true,

			assetId,

			soundId: `rbxassetid://${assetId}`,

			message: "Concert music uploaded successfully."
		});

	} catch (error) {

		console.error("----------------------------------------");
		console.error("❌ MUSIC GENERATION FAILED");
		console.error("----------------------------------------");

		if (error.response) {
			console.error(
				"HTTP Status:",
				error.response.status
			);

			let responseData = error.response.data;

			if (Buffer.isBuffer(responseData)) {
				try {
					responseData =
						responseData.toString("utf8");
				} catch (_) {}
			}

			console.error(
				"Response:",
				responseData
			);

		} else {
			console.error(
				"Error:",
				error.message
			);
		}

		return res.status(500).json({
			success: false,
			error: error.message || "Unknown server error."
		});
	}
});

app.listen(PORT, () => {
	console.log("----------------------------------------");
	console.log("🎤 AI IDOL MUSIC ENGINE ONLINE");
	console.log("Port:", PORT);
	console.log("----------------------------------------");
});
