#!/usr/bin/env node

const puppeteer = require('puppeteer');
const fs = require('fs');

// 定数定義
const BROWSER_CONFIG = {
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
};

const PAGE_CONFIG = {
  waitUntil: 'networkidle0',
  timeout: 60000
};

const SEARCH_DEPTH = {
  TIME_INFO: 15,
  CHANNEL_ID: 20
};

/**
 * YouTube クリップ情報を Puppeteer を使用して取得する
 * @param {string} url - YouTube クリップの URL
 * @returns {Promise<Object>} クリップ情報を含むオブジェクト
 */
const fetchClipInfoPuppeteer = async (url) => {
  console.log('Starting browser...');
  const browser = await puppeteer.launch(BROWSER_CONFIG);

  try {
    const page = await browser.newPage();

    console.log('Accessing URL:', url);
    await page.goto(url, PAGE_CONFIG);

    console.log('Page loaded, extracting metadata...');

    // Wait for meta tag
    await waitForMetaTag(page);

    // Extract metadata and page data
    const data = await extractPageData(page);

    // Build original video URL
    const videoUrl = buildVideoUrl(data);

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
 * メタタグの読み込みを待機する
 * @param {Object} page - Puppeteer ページオブジェクト
 */
const waitForMetaTag = async (page) => {
  try {
    await page.waitForSelector('meta[property="og:title"]', { timeout: 10000 });
  } catch {
    console.log('Warning: og:title not found, continuing anyway...');
  }
};

/**
 * ページからデータを抽出する
 * @param {Object} page - Puppeteer ページオブジェクト
 * @returns {Promise<Object>} 抽出されたデータ
 */
const extractPageData = async (page) => {
  return await page.evaluate((searchDepth) => {
    /* global document */
    const getMetaContent = (property) => {
      const meta = document.querySelector(`meta[property="${property}"]`);
      return meta ? meta.getAttribute('content') : null;
    };

    // 再帰的に時間情報を検索する
    const findTimeInfo = (obj, depth = 0) => {
      if (depth > searchDepth.TIME_INFO || !obj || typeof obj !== 'object') return null;

      if (obj.startTimeMs !== undefined && obj.endTimeMs !== undefined) {
        return obj;
      }

      if (obj.clipConfig && (obj.clipConfig.startTimeMs || obj.clipConfig.startTimeSeconds)) {
        return obj.clipConfig;
      }

      for (const key in obj) {
        const result = findTimeInfo(obj[key], depth + 1);
        if (result) return result;
      }
      return null;
    };

    // 再帰的にチャンネルIDを検索する
    const findChannelId = (obj, depth = 0) => {
      if (depth > searchDepth.CHANNEL_ID || !obj || typeof obj !== 'object') return null;

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

    // クリップ情報を初期化
    let clipData = null;
    let keywords = null;
    let author = null;
    let videoId = null;
    let channelId = null;
    let startTimeMs = null;
    let endTimeMs = null;

    try {
      const scripts = Array.from(document.querySelectorAll('script'));

      for (const script of scripts) {
        const text = script.textContent || '';

        // ytInitialPlayerResponse の解析
        if (text.includes('var ytInitialPlayerResponse')) {
          const playerData = parseYtInitialPlayerResponse(text);
          if (playerData) {
            videoId = videoId || playerData.videoId;
            keywords = keywords || playerData.keywords;
            author = author || playerData.author;
            clipData = clipData || playerData.clipData;
          }
        }

        // ytInitialData の解析
        if (text.includes('var ytInitialData')) {
          const ytDataResult = parseYtInitialData(text, findTimeInfo, findChannelId);
          if (ytDataResult) {
            clipData = clipData || ytDataResult.clipData;
            channelId = channelId || ytDataResult.channelId;
          }
        }
      }

      // clipData から情報を抽出
      if (clipData) {
        videoId = videoId || clipData.postId || clipData.videoId || null;
        startTimeMs = clipData.startTimeMs || (clipData.startTimeSeconds ? clipData.startTimeSeconds * 1000 : null);
        endTimeMs = clipData.endTimeMs || (clipData.endTimeSeconds ? clipData.endTimeSeconds * 1000 : null);
      }

      // フォールバック: サムネイル URL から videoId を抽出
      if (!videoId) {
        videoId = extractVideoIdFromThumbnail(getMetaContent('og:image'));
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

    // ヘルパー関数: ytInitialPlayerResponse を解析
    function parseYtInitialPlayerResponse(text) {
      const match = text.match(/var ytInitialPlayerResponse\s*=\s*({.+?});/s);
      if (!match) return null;

      try {
        const playerData = JSON.parse(match[1]);
        const result = {};

        if (playerData.videoDetails) {
          result.videoId = playerData.videoDetails.videoId;
          result.keywords = playerData.videoDetails.keywords;
          result.author = playerData.videoDetails.author;
        }

        if (playerData.clipConfig) {
          result.clipData = playerData.clipConfig;
        }

        if (playerData.microformat?.playerMicroformatRenderer?.clipConfig) {
          result.clipData = playerData.microformat.playerMicroformatRenderer.clipConfig;
        }

        return result;
      } catch (e) {
        console.error('Error parsing ytInitialPlayerResponse:', e);
        return null;
      }
    }

    // ヘルパー関数: ytInitialData を解析
    function parseYtInitialData(text, findTimeInfo, findChannelId) {
      const match = text.match(/var ytInitialData\s*=\s*({.+?});/s);
      if (!match) return null;

      try {
        const ytData = JSON.parse(match[1]);
        const timeInfo = findTimeInfo(ytData);
        const channelId = findChannelId(ytData);

        return {
          clipData: timeInfo,
          channelId: channelId
        };
      } catch (e) {
        console.error('Error parsing ytInitialData:', e);
        return null;
      }
    }

    // ヘルパー関数: サムネイルURLからvideoIdを抽出
    function extractVideoIdFromThumbnail(imageUrl) {
      if (!imageUrl) return null;
      const match = imageUrl.match(/\/vi\/([^/]+)\//);
      return match ? match[1] : null;
    }
  }, SEARCH_DEPTH);
};

/**
 * 動画URLを構築する
 * @param {Object} data - 抽出されたデータ
 * @returns {string|null} 動画URL
 */
const buildVideoUrl = (data) => {
  if (!data.videoId) return null;

  let url = `https://www.youtube.com/watch?v=${data.videoId}`;
  if (data.startTimeMs !== null) {
    url += `&t=${Math.floor(data.startTimeMs / 1000)}s`;
  }
  return url;
};

/**
 * 時間（ミリ秒）を "HH:MM:SS" 形式にフォーマットする
 * @param {number|null} milliseconds - ミリ秒
 * @returns {string} フォーマットされた時間文字列
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
 * コマンドライン引数を解析する
 * @param {string[]} args - コマンドライン引数
 * @returns {Object} 解析された引数 { clipUrl, outputFile }
 */
const parseArguments = (args) => {
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

  return { clipUrl, outputFile };
};

/**
 * YouTube クリップ URL の妥当性を検証する
 * @param {string} url - 検証する URL
 * @returns {boolean} URL が有効な場合は true
 */
const validateClipUrl = (url) => {
  return url.includes('youtube.com/clip/') || url.includes('youtu.be/clip/');
};

/**
 * クリップ情報を JSON データに変換する
 * @param {Object} info - クリップ情報
 * @returns {Object} JSON データ
 */
const buildJsonData = (info) => {
  return {
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
};

/**
 * JSON データをファイルに保存する
 * @param {string} outputFile - 出力ファイルパス
 * @param {Object} jsonData - 保存する JSON データ
 */
const saveJsonToFile = (outputFile, jsonData) => {
  try {
    fs.writeFileSync(outputFile, JSON.stringify(jsonData, null, 2), 'utf8');
    console.log(`✓ Clip information saved to ${outputFile}`);
  } catch (err) {
    console.error('Error: Failed to write file:', err.message);
    process.exit(1);
  }
};

/**
 * JSON データをコンソールに出力する
 * @param {Object} jsonData - 出力する JSON データ
 */
const printJsonToConsole = (jsonData) => {
  console.log('\n=== Clip Information ===');
  console.log(JSON.stringify(jsonData, null, 2));
  console.log('=======================\n');
};

/**
 * メイン処理関数
 */
const main = async () => {
  const args = process.argv.slice(2);
  const { clipUrl, outputFile } = parseArguments(args);

  if (!validateClipUrl(clipUrl)) {
    console.error('Error: Please provide a valid YouTube clip URL');
    process.exit(1);
  }

  try {
    const info = await fetchClipInfoPuppeteer(clipUrl);
    const jsonData = buildJsonData(info);

    if (outputFile) {
      saveJsonToFile(outputFile, jsonData);
    } else {
      printJsonToConsole(jsonData);
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
