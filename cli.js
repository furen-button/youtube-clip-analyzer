#!/usr/bin/env node

const puppeteer = require('puppeteer');
const fs = require('fs');

/**
 * Fetch clip information from a YouTube URL using Puppeteer.
 * @param {*} url
 * @returns {Promise<Object>} - A promise that resolves to the clip information.
 */
const fetchClipInfoPuppeteer = async (url) => {
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

    console.log('Page loaded, extracting metadata...');

    // Wait for meta tag
    try {
      await page.waitForSelector('meta[property="og:title"]', { timeout: 10000 });
    } catch {
      console.log('Warning: og:title not found, continuing anyway...');
    }

    // Extract metadata and page data
    const data = await page.evaluate(() => {
      /* global document */
      const getMetaContent = (property) => {
        const meta = document.querySelector(`meta[property="${property}"]`);
        return meta ? meta.getAttribute('content') : null;
      };

      // Get clip information from ytInitialData
      let clipData = null;
      let keywords = null;
      let author = null;
      let videoId = null;
      let channelId = null;
      let startTimeMs = null;
      let endTimeMs = null;

      try {
        // Search for clip information in page scripts
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const script of scripts) {
          const text = script.textContent || '';

          // Search for ytInitialPlayerResponse (priority)
          if (text.includes('var ytInitialPlayerResponse')) {
            const match = text.match(/var ytInitialPlayerResponse\s*=\s*({.+?});/s);
            if (match) {
              try {
                const playerData = JSON.parse(match[1]);

                if (playerData.videoDetails) {
                  if (!videoId) {
                    videoId = playerData.videoDetails.videoId;
                  }
                  if (!keywords && playerData.videoDetails.keywords) {
                    keywords = playerData.videoDetails.keywords;
                  }
                  if (!author && playerData.videoDetails.author) {
                    author = playerData.videoDetails.author;
                  }
                }

                // Search for clipConfig
                if (playerData.clipConfig) {
                  clipData = playerData.clipConfig;
                }

                // Search for microformat
                if (playerData.microformat && playerData.microformat.playerMicroformatRenderer) {
                  const microformat = playerData.microformat.playerMicroformatRenderer;
                  if (microformat.clipConfig) {
                    clipData = microformat.clipConfig;
                  }
                }
              } catch (e) {
                console.error('Error parsing ytInitialPlayerResponse:', e);
              }
            }
          }

          // Search for ytInitialData
          if (text.includes('var ytInitialData')) {
            const match = text.match(/var ytInitialData\s*=\s*({.+?});/s);
            if (match) {
              try {
                const ytData = JSON.parse(match[1]);

                // Search for object with time information
                const findTimeInfo = (obj, depth = 0) => {
                  if (depth > 15 || !obj || typeof obj !== 'object') return null;

                  // Search for object with startTimeMs/endTimeMs
                  if (obj.startTimeMs !== undefined && obj.endTimeMs !== undefined) {
                    return obj;
                  }

                  // Search for clipConfig
                  if (obj.clipConfig && (obj.clipConfig.startTimeMs || obj.clipConfig.startTimeSeconds)) {
                    return obj.clipConfig;
                  }

                  for (const key in obj) {
                    const result = findTimeInfo(obj[key], depth + 1);
                    if (result) return result;
                  }
                  return null;
                };

                const timeInfo = findTimeInfo(ytData);
                if (timeInfo && !clipData) {
                  clipData = timeInfo;
                }

                // Search for channel ID
                const findChannelId = (obj, depth = 0) => {
                  if (depth > 20 || !obj || typeof obj !== 'object') return null;

                  if (obj.browseId && obj.browseId.startsWith('UC')) {
                    return obj.browseId;
                  }

                  if (obj.channelId && obj.channelId.startsWith('UC')) {
                    return obj.channelId;
                  }

                  for (const key in obj) {
                    const result = findChannelId(obj[key], depth + 1);
                    if (result) return result;
                  }
                  return null;
                };

                if (!channelId) {
                  channelId = findChannelId(ytData);
                }
              } catch (e) {
                console.error('Error parsing ytInitialData:', e);
              }
            }
          }
        }

        // Extract information from clipData
        if (clipData) {
          if (!videoId) {
            videoId = clipData.postId || clipData.videoId || null;
          }
          startTimeMs = clipData.startTimeMs ? clipData.startTimeMs :
            (clipData.startTimeSeconds * 1000) || null;
          endTimeMs = clipData.endTimeMs ? clipData.endTimeMs :
            (clipData.endTimeSeconds * 1000) || null;
        }

        // Extract video ID from thumbnail URL (fallback)
        if (!videoId) {
          const imageUrl = getMetaContent('og:image');
          if (imageUrl) {
            const match = imageUrl.match(/\/vi\/([^/]+)\//);
            if (match) {
              videoId = match[1];
            }
          }
        }
      } catch (e) {
        console.error('Error parsing clip data:', e);
      }

      return {
        title: getMetaContent('og:title'),
        keywords: keywords,
        author: author,
        description: getMetaContent('og:description'),
        clipUrl: getMetaContent('og:url'),
        image: getMetaContent('og:image'),
        videoId: videoId,
        channelId: channelId,
        startTimeMs: Number(startTimeMs),
        endTimeMs: Number(endTimeMs),
        durationMs: (startTimeMs !== null && endTimeMs !== null) ? (endTimeMs - startTimeMs) : null
      };
    });

    // Build original video URL
    let videoUrl = null;
    if (data.videoId) {
      videoUrl = `https://www.youtube.com/watch?v=${data.videoId}`;
      if (data.startTimeMs !== null) {
        videoUrl += `&t=${Math.floor(data.startTimeMs / 1000)}s`;
      }
    }

    return {
      clipUrl: url,
      keywords: data.keywords,
      author: data.author,
      videoUrl: videoUrl,
      videoId: data.videoId,
      channelId: data.channelId,
      title: data.title,
      description: data.description,
      image: data.image,
      startTimeMs: data.startTimeMs,
      endTimeMs: data.endTimeMs,
      durationMs: data.durationMs
    };
  } finally {
    await browser.close();
  }
};

/**
 * 時間をフォーマットする
 * @param {*} milliseconds 
 * @returns "HH:MM:SS"
 */
const formatTime = (milliseconds) => {
  if (milliseconds === null) {
    return 'N/A';
  }
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours > 0) parts.push(String(hours).padStart(2, '0'));
  parts.push(String(minutes).padStart(2, '0'));
  parts.push(String(seconds).padStart(2, '0'));
  return parts.join(':');
};

/**
 * メイン処理関数
 */
const main = async () => {
  // コマンドライン引数を取得
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: youtube-clip-analyzer <YouTube Clip URL> [options]');
    console.error('Example: youtube-clip-analyzer https://www.youtube.com/clip/UgkxzjQPU1Ug_59l4pDl9d6-E0WR_RbjTsSl');
    console.error('\nOptions:');
    console.error('  --json <file>    Save result to JSON file');
    console.error('  --output <file>  Save result to JSON file (same as --json)');
    console.error('  -o <file>        Save result to JSON file (short form)');
    process.exit(1);
  }

  let clipUrl = null;
  let outputFile = null;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--json' || arg === '--output' || arg === '-o') {
      if (i + 1 < args.length) {
        outputFile = args[i + 1];
        i++;
      } else {
        console.error(`Error: ${arg} requires a filename`);
        process.exit(1);
      }
    } else if (!clipUrl) {
      clipUrl = arg;
    }
  }

  if (!clipUrl) {
    console.error('Error: Please specify a YouTube Clip URL');
    process.exit(1);
  }

  // URLの検証
  if (!clipUrl.includes('youtube.com/clip/') && !clipUrl.includes('youtu.be/clip/')) {
    console.error('Error: Please provide a valid YouTube clip URL');
    process.exit(1);
  }

  try {
    const info = await fetchClipInfoPuppeteer(clipUrl);
    const jsonData = {
      clipUrl: info.clipUrl,
      videoUrl: info.videoUrl,
      videoId: info.videoId,
      channelId: info.channelId,
      title: info.title,
      description: info.description,
      keywords: info.keywords,
      author: info.author,
      thumbnail: info.image,
      startTimeMs: info.startTimeMs,
      endTimeMs: info.endTimeMs,
      durationMs: info.durationMs,
      startTimeFormatted: formatTime(info.startTimeMs),
      endTimeFormatted: formatTime(info.endTimeMs),
      extractedAt: new Date().toISOString()
    };

    // JSON output
    if (outputFile) {
      try {
        fs.writeFileSync(outputFile, JSON.stringify(jsonData, null, 2), 'utf8');
        console.log(`✓ Clip information saved to ${outputFile}`);
      } catch (err) {
        console.error('Error: Failed to write file:', err.message);
        process.exit(1);
      }
    } else {
      // Console output
      console.log('\n=== Clip Information ===');
      console.log(JSON.stringify(jsonData, null, 2));
      console.log('=======================\n');
    }

    process.exit(0);
  } catch (err) {
    console.error('\nError:', err.message);
    console.error(err);
    process.exit(1);
  }
};

// メイン関数を実行
main();
