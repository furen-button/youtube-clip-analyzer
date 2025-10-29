#!/usr/bin/env node

const puppeteer = require('puppeteer');

const debugPlayerResponse = async (url) => {
  console.log('Starting browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();

    console.log('Accessing URL:', url);
    await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 60000
    });

    console.log('Page loaded, extracting ytInitialPlayerResponse...');

    const playerResponseData = await page.evaluate(() => {
      /* global document */
      const scripts = Array.from(document.querySelectorAll('script'));
      for (const script of scripts) {
        const text = script.textContent || '';

        if (text.includes('var ytInitialPlayerResponse')) {
          const match = text.match(/var ytInitialPlayerResponse\s*=\s*({.+?});/s);
          if (match) {
            try {
              const playerData = JSON.parse(match[1]);
              return {
                videoDetails: playerData.videoDetails,
                microformat: playerData.microformat
              };
            } catch (e) {
              console.error('Error parsing:', e.message);
              return null;
            }
          }
        }
      }
      return null;
    });

    console.log('\n=== ytInitialPlayerResponse Data ===');
    console.log(JSON.stringify(playerResponseData, null, 2));
  } finally {
    await browser.close();
  }
};

const url = process.argv[2] || 'https://www.youtube.com/clip/UgkxzjQPU1Ug_59l4pDl9d6-E0WR_RbjTsSl';
debugPlayerResponse(url);
