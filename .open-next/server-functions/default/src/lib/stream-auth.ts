
import crypto from 'crypto';

export function signStreamUrl(url: string, secret: string = process.env.STREAM_SECRET || ''): string {
  if (!secret) {
    console.warn('STREAM_SECRET is not set, skipping signature');
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
    
    const md5 = crypto
      .createHash('md5')
      .update(stringToSign)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    urlObj.searchParams.set('md5', md5);
    urlObj.searchParams.set('expires', expires.toString());

    return urlObj.toString();
  } catch (e) {
    console.error('Error signing stream URL:', e);
    return url;
  }
}
