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
    id: 'root',
    name: '默认歌单',
    title: '默认歌单',
    artist: 'Subsonic',
    kind: 'album',
    coverArt: defaultCover,
    trackCount: rootSongs.length,
    childUrl: baseUrl + '/rest/getIndexes.view?' + authQuery,
  };

  // 2. 收集其他目录下的歌单（来源于 indexes.index[].artist[]）
  const dirs = [];
  const groups = indexes.index || [];
  for (const group of groups) {
    const list = group.artist || [];
    for (const item of list) {
      dirs.push({
        id: String(item.id),
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
