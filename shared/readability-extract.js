// Injected into the active tab (bundled by build.sh) so the side panel can
// capture the article body for the Exponential Reading list. The server turns
// this HTML into markdown (exponential-app ADR-0072), so we only extract here.
import { Readability, isProbablyReaderable } from '@mozilla/readability';

globalThis.__expoExtractArticle = function () {
    const meta = (selector) => document.querySelector(selector)?.getAttribute('content') || undefined;
    let article = null;
    try {
        // Readability mutates the DOM it is given, so hand it a copy.
        article = new Readability(document.cloneNode(true)).parse();
    } catch (e) {
        console.warn('[Exponential] Readability failed:', e);
    }
    return {
        readerable: isProbablyReaderable(document),
        title: article?.title || document.title || undefined,
        content: article?.content || undefined,
        excerpt: article?.excerpt || meta('meta[name="description"]') || undefined,
        byline: article?.byline || meta('meta[name="author"]') || undefined,
        publishedTime: article?.publishedTime || meta('meta[property="article:published_time"]') || undefined,
    };
};
