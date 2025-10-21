# YouTube Clip Analyzer

A CLI tool to extract video information and playback duration from YouTube clip URLs.

## Features

- 🎬 Extract original video information from YouTube clips
- ⏱️ Get clip start time, end time, and playback duration
- 📝 Retrieve metadata (title, description, thumbnail)
- 💾 JSON output support
- 🚀 Easy to use with npx

## Installation

### Using npx (Recommended)

No installation needed:

```bash
npx youtube-clip-analyzer <YouTube Clip URL>
```

### Local Development

```bash
git clone <repository-url>
cd youtube-clip-analyzer
npm install
npm link
```

## Usage

### Basic Usage

```bash
youtube-clip-analyzer https://www.youtube.com/clip/UgkxzjQPU1Ug_59l4pDl9d6-E0WR_RbjTsSl
```

### Output to JSON

```bash
youtube-clip-analyzer https://www.youtube.com/clip/UgkxzjQPU1Ug_59l4pDl9d6-E0WR_RbjTsSl --json output.json
```


Or using short form:

```bash
youtube-clip-analyzer https://www.youtube.com/clip/UgkxzjQPU1Ug_59l4pDl9d6-E0WR_RbjTsSl -o output.json
```

## Options

| Option | Description |
|--------|-------------|
| `--json <file>` | Save result to JSON file |
| `--output <file>` | Save result to JSON file (same as --json) |
| `-o <file>` | Save result to JSON file (short form) |

## Output Examples

### JSON Output

```json
{
  "clipUrl": "https://www.youtube.com/clip/UgkxmkdM4ZSPkkZ7it8yZ9SsMNOaEEfdB3Po",
  "videoUrl": "https://www.youtube.com/watch?v=YpQ0y4fljvg&t=1590s",
  "videoId": "YpQ0y4fljvg",
  "title": "✂️ 世界一可愛いでしょ",
  "description": "5 seconds · Clipped by コーヴァスのなきごえ · Original video \"【雑談】世界一可愛いのでおしゃべりしちゃいます【にじさんじ】\" by フレン・E・ルスタリオ",
  "thumbnail": "https://i.ytimg.com/vi/YpQ0y4fljvg/maxresdefault.jpg",
  "startTimeMs": 1590656,
  "endTimeMs": 1595830,
  "durationMs": 5174,
  "startTimeFormatted": "26m30s (1590s)",
  "endTimeFormatted": "26m35s (1595s)",
  "extractedAt": "2025-10-21T16:41:54.633Z"
}
```

## Extracted Information

- **Clip URL**: URL of the clip
- **Video URL**: URL of the original video (with start time parameter)
- **Video ID**: YouTube video ID
- **Title**: Clip title
- **Description**: Clip description
- **Thumbnail**: Thumbnail image URL
- **Start Time**: Clip start time (in milliseconds)
- **End Time**: Clip end time (in milliseconds)
- **Duration**: Clip length (in milliseconds)

## Tech Stack

- [Node.js](https://nodejs.org/)
- [Puppeteer](https://pptr.dev/) - Headless browser automation
- YouTube page scraping (no official API used)

## How It Works

1. Launch a headless browser using Puppeteer to access the clip page
2. Extract `clipConfig` from `ytInitialPlayerResponse` in the page
3. Retrieve metadata (og:title, og:description, etc.)
4. Parse and format the extracted information
5. Output in console or JSON format

## Disclaimer

- This tool does not use the official YouTube API
- Please comply with YouTube's Terms of Service when using this tool
- Avoid excessive requests
- This tool may break if YouTube's page structure changes

## 仕組み

1. Puppeteerでクリップページにアクセス
2. ページ内の`ytInitialPlayerResponse`から`clipConfig`を抽出
3. メタデータ（og:title, og:descriptionなど）を取得
4. 取得した情報を整形して出力

## 注意事項

- このツールはYouTubeの公式APIを使用していません
- YouTubeの利用規約を遵守してご使用ください
- 過度なリクエストは避けてください
- ページ構造の変更により動作しなくなる可能性があります
