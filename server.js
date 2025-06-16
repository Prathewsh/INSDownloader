const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Serve downloaded files
app.use('/downloads', express.static('downloads'));

// Ensure downloads directory exists
if (!fs.existsSync('downloads')) {
    fs.mkdirSync('downloads');
}

app.post('/download', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url || !url.includes('instagram.com')) {
            return res.status(400).json({ error: 'Invalid Instagram URL' });
        }

        // Try direct API first
        try {
            const apiResult = await tryOfficialApi(url);
            return res.json(await processMedia(apiResult));
        } catch (apiError) {
            console.log('API failed, trying browser method');
        }

        // Browser method
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1');
        
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Extract video URL
        const videoUrl = await page.evaluate(() => {
            const video = document.querySelector('video');
            return video ? video.src : null;
        });

        await browser.close();

        if (!videoUrl) {
            return res.status(404).json({ error: 'No video found' });
        }

        res.json(await processMedia({ type: 'video', url: videoUrl }));

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ 
            error: 'Failed to fetch Instagram media',
            details: error.message 
        });
    }
});

async function tryOfficialApi(url) {
    const shortcode = url.split('/').filter(Boolean).pop();
    const apiUrl = `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`;
    
    const response = await axios.get(apiUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
        }
    });

    const media = response.data.graphql?.shortcode_media;
    if (media?.video_url) {
        return { type: 'video', url: media.video_url };
    }
    throw new Error('No video found in API response');
}

async function processMedia(media) {
    // Download the file to server first
    const response = await axios.get(media.url, { responseType: 'stream' });
    const filename = `instagram_${Date.now()}.${media.type === 'video' ? 'mp4' : 'jpg'}`;
    const filepath = path.join(__dirname, 'downloads', filename);
    
    const writer = fs.createWriteStream(filepath);
    response.data.pipe(writer);
    
    await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });

    return {
        ...media,
        downloadUrl: `/downloads/${filename}`,
        filename: filename
    };
}

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});