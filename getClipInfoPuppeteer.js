const puppeteer = require('puppeteer');

const CLIP_URL = 'https://www.youtube.com/clip/UgkxzjQPU1Ug_59l4pDl9d6-E0WR_RbjTsSl';

async function fetchClipInfoPuppeteer(url) {
  console.log('Starting browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    
    // ページのコンソールログを表示
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    
    console.log('Accessing URL:', url);
    await page.goto(url, { 
      waitUntil: 'networkidle0',
      timeout: 60000
    });
    
    console.log('Page loaded, waiting for metadata...');
    
    // メタタグが存在するまで待機
    try {
      await page.waitForSelector('meta[property="og:title"]', { timeout: 10000 });
    } catch (e) {
      console.log('Warning: og:title not found, continuing anyway...');
    }
    
    console.log('Extracting metadata...');
    
    // メタデータとページ内のデータを取得
    const data = await page.evaluate(() => {
      const getMetaContent = (property) => {
        const meta = document.querySelector(`meta[property="${property}"]`);
        return meta ? meta.getAttribute('content') : null;
      };
      
      // ytInitialDataからクリップ情報を取得
      let clipData = null;
      let videoId = null;
      let startTime = null;
      let endTime = null;
      
      try {
        // ページ内のスクリプトからクリップ情報を探す
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const script of scripts) {
          const text = script.textContent || '';
          
          // ytInitialPlayerResponseを探す（優先）
          if (text.includes('var ytInitialPlayerResponse')) {
            const match = text.match(/var ytInitialPlayerResponse\s*=\s*({.+?});/s);
            if (match) {
              try {
                const playerData = JSON.parse(match[1]);
                console.log('Found ytInitialPlayerResponse');
                
                if (playerData.videoDetails) {
                  if (!videoId) videoId = playerData.videoDetails.videoId;
                  console.log('Video ID from videoDetails:', videoId);
                }
                
                // clipConfigを探す
                if (playerData.clipConfig) {
                  clipData = playerData.clipConfig;
                  console.log('Found clipConfig in playerData:', JSON.stringify(clipData, null, 2));
                }
                
                // microformatを探す
                if (playerData.microformat && playerData.microformat.playerMicroformatRenderer) {
                  const microformat = playerData.microformat.playerMicroformatRenderer;
                  if (microformat.clipConfig) {
                    clipData = microformat.clipConfig;
                    console.log('Found clipConfig in microformat:', JSON.stringify(clipData, null, 2));
                  }
                }
              } catch (e) {
                console.error('Error parsing ytInitialPlayerResponse:', e);
              }
            }
          }
          
          // ytInitialDataを探す
          if (text.includes('var ytInitialData')) {
            const match = text.match(/var ytInitialData\s*=\s*({.+?});/s);
            if (match) {
              try {
                const ytData = JSON.parse(match[1]);
                console.log('Found ytInitialData');
                
                // クリップ時間情報を持つオブジェクトを探す
                const findTimeInfo = (obj, depth = 0, path = '') => {
                  if (depth > 15 || !obj || typeof obj !== 'object') return null;
                  
                  // startTimeMs/endTimeMs を持つオブジェクトを探す
                  if (obj.startTimeMs !== undefined && obj.endTimeMs !== undefined) {
                    console.log('Found time info at path:', path);
                    return obj;
                  }
                  
                  // clipConfig を探す
                  if (obj.clipConfig && (obj.clipConfig.startTimeMs || obj.clipConfig.startTimeSeconds)) {
                    console.log('Found clipConfig at path:', path);
                    return obj.clipConfig;
                  }
                  
                  for (const key in obj) {
                    const result = findTimeInfo(obj[key], depth + 1, path + '.' + key);
                    if (result) return result;
                  }
                  return null;
                };
                
                const timeInfo = findTimeInfo(ytData);
                if (timeInfo && !clipData) {
                  clipData = timeInfo;
                }
              } catch (e) {
                console.error('Error parsing ytInitialData:', e);
              }
            }
          }
        }
        
        // clipDataから情報を抽出
        if (clipData) {
          console.log('Found clipData:', JSON.stringify(clipData, null, 2));
          if (!videoId) videoId = clipData.postId || clipData.videoId || null;
          startTime = clipData.startTimeMs ? Math.floor(clipData.startTimeMs / 1000) : 
                     clipData.startTimeSeconds || null;
          endTime = clipData.endTimeMs ? Math.floor(clipData.endTimeMs / 1000) : 
                   clipData.endTimeSeconds || null;
        } else {
          console.log('clipData not found, trying alternative methods...');
        }
        
        // サムネイルURLから動画IDを抽出（フォールバック）
        if (!videoId) {
          const imageUrl = getMetaContent('og:image');
          if (imageUrl) {
            const match = imageUrl.match(/\/vi\/([^\/]+)\//);
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
        description: getMetaContent('og:description'),
        clipUrl: getMetaContent('og:url'),
        image: getMetaContent('og:image'),
        videoId: videoId,
        startTime: startTime,
        endTime: endTime
      };
    });
    
    console.log('Data extracted:', JSON.stringify(data, null, 2));
    
    // descriptionから再生秒数を抽出（フォールバック）
    let duration = null;
    
    if (data.startTime !== null && data.endTime !== null) {
      duration = data.endTime - data.startTime;
    } else if (data.description) {
      // "7 seconds" のようなフォーマットを探す
      const secondsMatch = data.description.match(/(\d+)\s+seconds?/i);
      if (secondsMatch) {
        duration = parseInt(secondsMatch[1], 10);
      } else {
        // "0:15 - 0:30" のようなフォーマットを探す
        const timeMatch = data.description.match(/(\d+):(\d+)\s*-\s*(\d+):(\d+)/);
        if (timeMatch) {
          const startMin = parseInt(timeMatch[1], 10);
          const startSec = parseInt(timeMatch[2], 10);
          const endMin = parseInt(timeMatch[3], 10);
          const endSec = parseInt(timeMatch[4], 10);
          
          if (data.startTime === null) data.startTime = startMin * 60 + startSec;
          if (data.endTime === null) data.endTime = endMin * 60 + endSec;
          duration = data.endTime - data.startTime;
        }
      }
    }
    
    // 元動画URLを構築
    let videoUrl = null;
    if (data.videoId) {
      videoUrl = `https://www.youtube.com/watch?v=${data.videoId}`;
      if (data.startTime !== null) {
        videoUrl += `&t=${data.startTime}s`;
      }
    }
    
    return {
      clipUrl: url,
      videoUrl: videoUrl,
      videoId: data.videoId,
      title: data.title,
      description: data.description,
      image: data.image,
      startTime: data.startTime,
      endTime: data.endTime,
      duration: duration,
    };
  } finally {
    await browser.close();
  }
}

fetchClipInfoPuppeteer(CLIP_URL).then(info => {
  console.log('\n=== クリップ情報 ===');
  console.log('クリップURL:', info.clipUrl);
  console.log('動画URL:', info.videoUrl);
  console.log('動画ID:', info.videoId || '取得できませんでした');
  console.log('タイトル:', info.title);
  console.log('説明:', info.description);
  console.log('サムネイル:', info.image);
  console.log('開始時間:', info.startTime !== null ? `${info.startTime}秒` : '取得できませんでした');
  console.log('終了時間:', info.endTime !== null ? `${info.endTime}秒` : '取得できませんでした');
  console.log('再生秒数:', info.duration !== null ? `${info.duration}秒` : '取得できませんでした');
  console.log('==================\n');
}).catch(err => {
  console.error('エラーが発生しました:', err.message);
  console.error(err);
});
