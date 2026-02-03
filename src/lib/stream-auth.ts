import { logger } from '@/lib/logger';
import { md5Base64 } from '@/lib/md5';

export function signStreamUrl(url: string, secret: string = process.env.STREAM_SECRET || ''): string {
  if (!secret) {
    // Reduce noise, only log once or if explicitly needed? 
    // Actually this is a config issue, warn is good.
    // logger.warn('STREAM_SECRET is not set, skipping signature', {}, 'StreamAuth');
    // Commented out to avoid spamming logs if intentional.
    return url;
  }

  try {
    const urlObj = new URL(url);

    // Only sign .m3u8 files
    if (!urlObj.pathname.endsWith('.m3u8')) {
      return url;
    }

    // Expire in 2 hours
    const expires = Math.floor(Date.now() / 1000) + 7200;

    // Nginx secure_link_md5 "$secure_link_expires$uri $secret_key";
    // URI usually implies the path (e.g. /stream/live.m3u8)
    const stringToSign = `${expires}${urlObj.pathname} ${secret}`;

    const md5Str = md5Base64(stringToSign);
    const md5 = md5Str
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    urlObj.searchParams.set('md5', md5);
    urlObj.searchParams.set('expires', expires.toString());

    return urlObj.toString();
  } catch (e: any) {
    logger.error('Error signing stream URL', e, 'StreamAuth');
    return url;
  }
}
