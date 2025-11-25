// Stremio An1me.to Addon - FIXED EPISODE DETECTION
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');

const manifest = {
    id: 'community.an1me.to',
    version: '2.1.0',
    name: 'An1me.to Advanced',
    description: 'Ελληνικά anime από το an1me.to με Puppeteer',
    resources: ['catalog', 'meta', 'stream'],
    types: ['series'],
    catalogs: [
        {
            type: 'series',
            id: 'an1me-catalog',
            name: 'An1me.to',
            extra: [
                { name: 'search', isRequired: false }
            ]
        }
    ],
    idPrefixes: ['an1me:']
};

const builder = new addonBuilder(manifest);
const BASE_URL = 'https://an1me.to';

// Browser instance
let browserInstance = null;

async function getBrowser() {
    if (!browserInstance) {
        console.log('🌐 Launching browser...');
        browserInstance = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu'
            ]
        });
        console.log('✅ Browser launched');
    }
    return browserInstance;
}

async function fetchPage(url) {
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'el-GR,el;q=0.9',
            },
            timeout: 15000
        });
        return response.data;
    } catch (error) {
        console.error('❌ Fetch error:', url, error.message);
        return null;
    }
}

function extractAnimeSlug(link) {
    if (!link) return null;
    
    if (link.includes('/watch/')) {
        return link.split('/watch/')[1]?.split('-episode-')[0];
    } else if (link.includes('/anime/')) {
        const slug = link.split('/anime/')[1]?.replace(/\/+$/, '');
        return slug;
    }
    return null;
}

async function extractVideoUrl(episodeUrl) {
    console.log('🔍 Extracting video URL with Puppeteer...');
    
    let page;
    try {
        const browser = await getBrowser();
        page = await browser.newPage();
        
        const videoUrls = [];
        
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            request.continue();
        });
        
        page.on('response', async (response) => {
            const url = response.url();
            
            if (url.includes('.m3u8') || 
                url.includes('.mp4') || 
                url.includes('master.m3u8') ||
                url.includes('playlist.m3u8') ||
                url.includes('/video/') ||
                url.includes('stream')) {
                
                console.log(`📹 Found video URL: ${url.substring(0, 80)}...`);
                videoUrls.push(url);
            }
        });
        
        console.log(`🌐 Loading: ${episodeUrl}`);
        await page.goto(episodeUrl, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const iframes = await page.$$('iframe');
        console.log(`🔍 Found ${iframes.length} iframes`);
        
        for (let i = 0; i < iframes.length; i++) {
            try {
                const iframeSrc = await iframes[i].evaluate(el => el.src);
                if (iframeSrc && iframeSrc.startsWith('http')) {
                    console.log(`📺 Checking iframe ${i + 1}`);
                    
                    await page.goto(iframeSrc, {
                        waitUntil: 'networkidle2',
                        timeout: 20000
                    });
                    
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            } catch (e) {
                console.log(`⚠️ Iframe ${i + 1} error:`, e.message);
            }
        }
        
        await page.close();
        
        if (videoUrls.length > 0) {
            const m3u8Url = videoUrls.find(url => url.includes('.m3u8'));
            const mp4Url = videoUrls.find(url => url.includes('.mp4'));
            const bestUrl = m3u8Url || mp4Url || videoUrls[0];
            
            console.log(`✅ Best video URL found`);
            return bestUrl;
        }
        
        console.log('❌ No video URLs found');
        return null;
        
    } catch (error) {
        console.error('❌ Puppeteer error:', error.message);
        if (page) await page.close();
        return null;
    }
}

// CATALOG
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    console.log('📚 Catalog request');

    if (type !== 'series' || id !== 'an1me-catalog') {
        return { metas: [] };
    }

    try {
        let url = BASE_URL;
        
        if (extra.search) {
            url = `${BASE_URL}/search/?s_keyword=${encodeURIComponent(extra.search)}`;
        }

        const html = await fetchPage(url);
        if (!html) return { metas: [] };

        const $ = cheerio.load(html);
        const metas = [];

        $('.anime-card').each((i, element) => {
            try {
                const $card = $(element);
                
                const link = $card.find('a[href*="/watch/"]').first().attr('href') 
                          || $card.find('a[href*="/anime/"]').first().attr('href');
                
                const slug = extractAnimeSlug(link);
                if (!slug) return;
                
                const $title = $card.find('h3');
                const title = $title.find('.group-data-\\[language\\=jp\\]\\/body\\:hidden').text().trim() 
                           || $title.text().trim();
                
                if (!title) return;
                
                const poster = $card.find('img').attr('src');
                const rating = $card.find('.text-yellow-400').parent().text().trim();
                const description = $card.find('p.text-muted').text().trim().substring(0, 200);

                metas.push({
                    id: `an1me:${slug}`,
                    type: 'series',
                    name: title,
                    poster: poster || undefined,
                    posterShape: 'poster',
                    description: description || 'Ελληνικά υπότιτλοι',
                    imdbRating: rating || undefined,
                    background: poster || undefined
                });
                
            } catch (e) {
                console.error('Parse error:', e.message);
            }
        });

        console.log(`✅ Catalog: ${metas.length} anime`);
        return { metas: metas.slice(0, 100) };

    } catch (error) {
        console.error('❌ Catalog error:', error);
        return { metas: [] };
    }
});

// META - FIXED EPISODE DETECTION
builder.defineMetaHandler(async ({ type, id }) => {
    console.log('📄 Meta request:', id);

    if (!id.startsWith('an1me:')) {
        return { meta: {} };
    }

    try {
        const slug = id.replace('an1me:', '').replace(/\/+$/, '');
        const animeUrl = `${BASE_URL}/anime/${slug}/`;
        
        console.log(`🔍 Fetching: ${animeUrl}`);
        const html = await fetchPage(animeUrl);
        if (!html) {
            return { 
                meta: { 
                    id, 
                    type: 'series', 
                    name: slug.replace(/-/g, ' '),
                    posterShape: 'poster'
                } 
            };
        }

        const $ = cheerio.load(html);
        
        const title = $('h1').find('.anime').first().text().trim() 
                   || slug.replace(/-/g, ' ');
        const poster = $('.anime-main-image').first().attr('src');
        const background = $('div[style*="background"]').first().css('background-image')?.match(/url\(['"]?([^'")]+)['"]?\)/)?.[1];
        const description = $('section[aria-label="Anime Overview"] p').first().text().trim();
        
        const genres = [];
        $('a[href*="/genre/"]').each((i, el) => {
            const genre = $(el).text().trim();
            if (genre) genres.push(genre);
        });

        const rating = $('.text-yellow-400').parent().text().trim();

        const videos = [];
        
        // METHOD 1: Count episodes from grid
        const episodeLinks = [];
        $('#episodeGrid a[href*="/watch/"]').each((i, el) => {
            const href = $(el).attr('href');
            const dataSearch = $(el).attr('data-search');
            if (href && dataSearch) {
                episodeLinks.push({
                    number: parseInt(dataSearch),
                    url: href
                });
            }
        });

        // DEBUG: Print the HTML to see what's there
console.log('🔍 HTML snippet:', $.html('#episodeGrid').substring(0, 500));

console.log(`📺 Found ${episodeLinks.length} episodes in grid`);
        console.log(`📺 Found ${episodeLinks.length} episodes in grid`);
        
        // METHOD 2: Try to get from metadata
        let metadataEpisodes = 0;
        $('dl div').each((i, el) => {
            const $el = $(el);
            const label = $el.find('dt').text().trim();
            const value = $el.find('dd').text().trim();
            
            if (label === 'Episodes' && value && value !== 'N/A') {
                metadataEpisodes = parseInt(value);
            }
        });
        
        // Use whichever method gives us episodes
        let totalEpisodes = 0;
        
        if (episodeLinks.length > 0) {
            // Get max episode number from grid
            totalEpisodes = Math.max(...episodeLinks.map(e => e.number));
            console.log(`✅ Using grid episodes: ${totalEpisodes}`);
        } else if (metadataEpisodes > 0) {
            totalEpisodes = metadataEpisodes;
            console.log(`✅ Using metadata episodes: ${totalEpisodes}`);
        }

        // Fallback: If no episodes found, create 50 default
if (totalEpisodes === 0) {
    totalEpisodes = 50;
    console.log('⚠️ No episodes detected, using fallback: 50 episodes');
}

if (totalEpisodes > 0 && totalEpisodes <= 500) {
    for (let i = 1; i <= totalEpisodes; i++) {
                videos.push({
                    id: `an1me:${slug}:1:${i}`,
                    title: `Episode ${i}`,
                    season: 1,
                    episode: i,
                    released: new Date().toISOString(),
                    thumbnail: poster
                });
            }
        }

        console.log(`✅ Meta: ${title} - ${videos.length} episodes`);

        return {
            meta: {
                id,
                type: 'series',
                name: title,
                poster: poster || undefined,
                posterShape: 'poster',
                background: background || poster || undefined,
                description: description || 'Παρακολουθήστε με ελληνικούς υπότιτλους',
                releaseInfo: '2024',
                imdbRating: rating || undefined,
                genres: genres.length > 0 ? genres : undefined,
                runtime: '24 min',
                videos: videos.length > 0 ? videos : undefined
            }
        };

    } catch (error) {
        console.error('❌ Meta error:', error);
        return { 
            meta: { 
                id, 
                type: 'series', 
                name: 'Unknown Anime',
                posterShape: 'poster'
            } 
        };
    }
});

// STREAM WITH PUPPETEER
builder.defineStreamHandler(async ({ type, id }) => {
    console.log('🎬 Stream request:', id);

    if (!id.startsWith('an1me:')) {
        return { streams: [] };
    }

    try {
        const parts = id.split(':');
        
        if (parts.length < 4) {
            console.log('❌ Invalid ID format');
            return { streams: [] };
        }

        const slug = parts[1].replace(/\/+$/, '');
        const episode = parts[3];
        
        const episodeUrl = `${BASE_URL}/watch/${slug}-episode-${episode}/`;
        console.log(`📺 Episode URL: ${episodeUrl}`);
        
        // Extract video URL with Puppeteer
        const videoUrl = await extractVideoUrl(episodeUrl);
        
        const streams = [];
        
        if (videoUrl) {
            streams.push({
                name: 'An1me.to - Direct Stream',
                title: `Episode ${episode}`,
                url: videoUrl,
                behaviorHints: {
                    notWebReady: false,
                    bingeGroup: `an1me-${slug}`
                }
            });
            console.log('✅ Direct stream added');
        }
        
        // Fallback
        streams.push({
            name: 'An1me.to - Watch in Browser',
            title: `Episode ${episode}`,
            externalUrl: episodeUrl
        });
        
        console.log(`✅ Total streams: ${streams.length}`);
        return { streams };

    } catch (error) {
        console.error('❌ Stream error:', error);
        
        const parts = id.split(':');
        const slug = parts[1]?.replace(/\/+$/, '') || 'unknown';
        const episode = parts[3] || '1';
        
        return {
            streams: [{
                name: 'An1me.to - Watch in Browser',
                externalUrl: `${BASE_URL}/watch/${slug}-episode-${episode}/`
            }]
        };
    }
});

// Cleanup
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    if (browserInstance) {
        await browserInstance.close();
    }
    process.exit(0);
});

// START SERVER
const PORT = process.env.PORT || 8080;
serveHTTP(builder.getInterface(), { port: PORT, host: '0.0.0.0' });

console.log(`
╔════════════════════════════════════════════╗
║  🚀 An1me.to - PUPPETEER VERSION v2.1     ║
╠════════════════════════════════════════════╣
║  📺 http://0.0.0.0:${PORT}/manifest.json      ║
║                                            ║
║  ⚡ Fixed episode detection               ║
║  🎯 Direct + Browser streams              ║
╚════════════════════════════════════════════╝
`);
