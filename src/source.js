/**
 * Subsonic / Navidrome / Airsonic 辅助运行时函数库
 * 提供请求鉴权签名、URL 清洗、推荐歌单生成与目录歌曲提取功能
 */

/**
 * 获取清洗后的服务器基础地址
 * 移除浏览器地址栏常见的 /index.view 或 /login.view 等后缀
 */
function getBaseUrl() {
  const raw = (typeof source !== 'undefined' && source && source.url) || '';
  return raw.replace(/\/(index|login)\.view(\?.*)?$/i, '').replace(/\/+$/, '');
}

/**
 * 生成 Subsonic REST API 鉴权查询字符串
 * 优先读取独立凭据 user 和 password，兼容单字段 var (user:password)
 * 使用标准 Subsonic MD5 盐值哈希: token = md5(password + salt)
 */
function auth() {
  let u = src.vars.get('user') || src.vars.get('username') || '';
  let p = src.vars.get('password') || '';
  if (!u || !p) {
    const v = String(src.vars.get('var') || '');
    if (v.includes(':')) {
      const idx = v.indexOf(':');
      u = u || v.slice(0, idx);
      p = p || v.slice(idx + 1);
    }
  }
  const s = src.crypto.randomHex(8);
  const t = src.crypto.md5(p + s);
  return 'u=' + encodeURIComponent(u) + '&t=' + t + '&s=' + s + '&v=1.16.1&c=BBeBee&f=json';
}

/**
 * 生成推荐歌单列表
 * 规则要求：返回的歌单列表第1个是默认歌单（来自根目录），之后的是其他目录下的歌单（随机）
 * @param {object} res - getIndexes.view 响应对象
 * @param {string} sourceUrl - 音乐源基础地址
 */
function buildRecommendList(res, sourceUrl) {
  const root = (res && res['subsonic-response']) || res || {};
  const indexes = root.indexes || {};
  const baseUrl = getBaseUrl() || (sourceUrl ? String(sourceUrl).replace(/\/+$/, '') : '');
  const authQuery = auth();

  // 1. 构建首位默认歌单（来源于根目录音乐文件 indexes.child）
  const rootSongs = indexes.child || [];
  const defaultCover = (rootSongs[0] && (rootSongs[0].coverArt || rootSongs[0].id)) || '';
  const defaultPlaylist = {
    id: 'dir-root',
    name: '默认歌单',
    title: '默认歌单',
    artist: 'Subsonic',
    kind: 'album',
    coverArt: defaultCover,
    trackCount: rootSongs.length,
    childUrl: baseUrl + '/rest/getIndexes.view?' + authQuery,
  };

  // 2. 收集其他目录下的歌单（来源于 indexes.index[].artist[]）
  // 使用 dir- 前缀隔离物理目录 ID 与 ID3 专辑 ID，防止 URN 碰撞
  const dirs = [];
  const groups = indexes.index || [];
  for (const group of groups) {
    const list = group.artist || [];
    for (const item of list) {
      dirs.push({
        id: 'dir-' + String(item.id),
        name: item.name || item.title || 'Unknown Directory',
        title: item.name || item.title || 'Unknown Directory',
        artist: 'Subsonic',
        kind: 'album',
        coverArt: item.coverArt || item.id,
        childUrl: baseUrl + '/rest/getMusicDirectory.view?id=' + encodeURIComponent(item.id) + '&' + authQuery,
      });
    }
  }

  // 3. 对其他目录下的歌单进行随机打乱 (Fisher-Yates Shuffle)
  for (let i = dirs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = dirs[i];
    dirs[i] = dirs[j];
    dirs[j] = temp;
  }

  // 4. 返回：第一个是默认歌单，之后是随机的其他目录歌单
  return [defaultPlaylist, ...dirs];
}

/**
 * 提取目录、根目录索引或专辑中的歌曲列表
 * 自动排除子文件夹，仅保留音频文件
 * @param {object} res - 响应对象
 */
function getDirectorySongs(res) {
  const root = (res && res['subsonic-response']) || res || {};
  const list = (root.directory && root.directory.child) ||
    (root.indexes && root.indexes.child) ||
    (root.album && root.album.song) || [];
  return list.filter(function (item) {
    return !item.isDir;
  });
}

/**
 * 获取 Subsonic / Navidrome 歌曲歌词
 * 优先尝试 OpenSubsonic getLyricsBySongId（若服务器支持，可直接提供带时间戳的同步歌词）；
 * 若无或不支持，通过 getLyrics.view?artist=...&title=... 获取纯文本/LRC 歌词；
 * 若服务器无歌词或返回空对象，返回空字符串，触发回退至应用默认歌词源（如 LRCLIB）
 */
async function getSubsonicLyrics() {
  const baseUrl = getBaseUrl();
  if (!baseUrl) return '';
  const authQuery = auth();

  const trackObj = (typeof track !== 'undefined' && track) ? track : {};
  let artist = trackObj.artist || trackObj.albumArtist || '';
  let title = trackObj.title || '';
  const trackId = trackObj.id || '';

  // 1. 若支持 OpenSubsonic getLyricsBySongId，优先根据 trackId 尝试获取（可能包含带时间轴的同步歌词）
  if (trackId) {
    try {
      const byIdUrl = baseUrl + '/rest/getLyricsBySongId.view?id=' + encodeURIComponent(trackId) + '&' + authQuery;
      const resById = await src.get(byIdUrl);
      if (resById && resById.status === 200 && resById.body) {
        const data = src.parse.json(resById.body);
        const resp = data && data['subsonic-response'];
        if (resp && resp.lyricsList && Array.isArray(resp.lyricsList.structuredLyrics)) {
          const structured = resp.lyricsList.structuredLyrics[0];
          if (structured && Array.isArray(structured.line) && structured.line.length > 0) {
            const pad = function (n, len) { return (new Array(len + 1).join('0') + n).slice(-len); };
            const lrcLines = structured.line.map(function (l) {
              const ms = l.start || 0;
              const m = Math.floor(ms / 60000);
              const s = Math.floor((ms % 60000) / 1000);
              const c = Math.floor((ms % 1000) / 10);
              return '[' + pad(m, 2) + ':' + pad(s, 2) + '.' + pad(c, 2) + ']' + (l.value || '');
            });
            return lrcLines.join('\n');
          }
        }
      }
    } catch (e) {
      // 忽略 404 或解析异常，继续回退到 getLyrics.view
    }
  }

  // 2. 若缺少 artist 或 title，尝试通过 getSong.view 补全
  if ((!artist || !title) && trackId) {
    try {
      const songUrl = baseUrl + '/rest/getSong.view?id=' + encodeURIComponent(trackId) + '&' + authQuery;
      const songRes = await src.get(songUrl);
      if (songRes && songRes.body) {
        const songData = src.parse.json(songRes.body);
        const song = songData && songData['subsonic-response'] && songData['subsonic-response'].song;
        if (song) {
          artist = artist || song.artist || '';
          title = title || song.title || '';
        }
      }
    } catch (e) {
      // ignore
    }
  }

  if (!artist && !title) return '';

  // 3. 调用标准 Subsonic getLyrics.view 获取歌词
  try {
    const lyricUrl = baseUrl + '/rest/getLyrics.view?artist=' + encodeURIComponent(artist) + '&title=' + encodeURIComponent(title) + '&' + authQuery;
    const res = await src.get(lyricUrl);
    if (!res || !res.body) return '';
    const data = src.parse.json(res.body);
    const lyrics = data && data['subsonic-response'] && data['subsonic-response'].lyrics;
    if (!lyrics) return '';
    const content = lyrics.content || lyrics.value || lyrics['#'] || '';
    return typeof content === 'string' ? content.trim() : '';
  } catch (e) {
    return '';
  }
}
