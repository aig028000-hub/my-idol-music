const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());
let buf = null;

app.post('/generate', async (req, res) => {
    try {
        const { prompt } = req.body;
        console.log("Generating music for:", prompt);
        const response = await axios.post('https://huggingface.co', ...
            { inputs: prompt }, 
            { 
                headers: { "Authorization": process.env.HF_TOKEN },
                responseType: 'arraybuffer' 
            }
        );
        buf = Buffer.from(response.data);
        res.json({ success: true, audioUrl: `https://${req.get('host')}/stream.mp3` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/stream.mp3', (req, res) => {
    if (!buf) return res.status(404).send("No music yet.");
    res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': buf.length, 'Accept-Ranges': 'bytes' });
    res.send(buf);
});

app.listen(process.env.PORT || 3000, () => console.log('Online!'));
