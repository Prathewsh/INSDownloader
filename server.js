const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Use stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.post('/download', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url || !isValidInstagramUrl(url)) {
            return res.status(400).json({ 
                error: 'Invalid Instagram URL',
                success: false
            });
        }

        // Try direct API first
        try {
            const apiResult = await tryOfficialApi(url);
            return res.json({
                ...apiResult,
                source: 'api',
                success: true
            });
        } catch (apiError) {
            console.log('API failed, trying browser method:', apiError.message);
        }

        // Browser method with enhanced stealth
        const browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        });
        
        const page = await browser.newPage();
        await page.setUserAgent('Instagram 269.0.0.18.75 Android (28/9; 320dpi; 720x1468; Xiaomi; Redmi 6A; cereus; qcom; en_US; 314665256)');
        await page.setViewport({ width: 375, height: 812, isMobile: true });
        
        console.log('Navigating to Instagram URL...');
        await page.goto(url, { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });

        console.log('Waiting for video element...');
        await page.waitForSelector('video', { timeout: 15000 });
        
        const videoUrl = await page.evaluate(() => {
            const video = document.querySelector('video');
            return video ? video.src : null;
        });

        const thumbnailUrl = await page.evaluate(() => {
            const img = document.querySelector('img');
            return img ? img.src : null;
        });

        await browser.close();

        if (!videoUrl) {
            return res.status(404).json({ 
                error: 'No video found',
                success: false
            });
        }

        res.json({
            type: 'video',
            url: videoUrl,
            thumbnail: thumbnailUrl,
            source: 'browser',
            success: true
        });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ 
            error: 'Failed to fetch Instagram media',
            details: error.message,
            success: false
        });
    }
});

async function tryOfficialApi(url) {
    const shortcode = url.split('/').filter(Boolean).pop();
    const apiUrl = `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`;
    
    const response = await axios.get(apiUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
            'X-IG-App-ID': '936619743392459',
            'Accept-Language': 'en-US,en;q=0.9'
        },
        timeout: 10000
    });

    const media = response.data.graphql?.shortcode_media;
    if (media?.video_url) {
        return { 
            type: 'video', 
            url: media.video_url,
            thumbnail: media.display_url
        };
    }
    throw new Error('No video found in API response');
}

function isValidInstagramUrl(url) {
    const instaRegex = /https?:\/\/(www\.)?instagram\.com\/(reel|p|tv)\/[a-zA-Z0-9_-]+\/?/;
    return instaRegex.test(url);
}

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});