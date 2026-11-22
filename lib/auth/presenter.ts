import {createHmac,createHash,timingSafeEqual} from 'node:crypto';
const destinations = new Map([
 ['pharmacy', '/app/pharmacy/today'], ['simulation', '/simulation'],
 ['stage', '/stage'], ['suite', '/app/safety/business-tests'], ['phone', '/app/pharmacy/phone'],
]);
export function presenterDestination(key: unknown) {
 if (typeof key !== 'string') return '/app';
 if (/^\/app(?:\/[a-zA-Z0-9_-]+)*$/.test(key)) return key;
 return destinations.get(key) ?? '/app';
}
export const presenterCookie='__Host-aegis-presenter';
export function sameSecret(a:string,b:string) {
 const digest=(s:string)=>createHash('sha256').update(s).digest();
 return timingSafeEqual(digest(a),digest(b));
}
function sign(expiry:string) {
 return createHmac('sha256',process.env.AEGIS_PRESENTER_SECRET!).update('aegis/hosted-presenter/v1:'+expiry).digest('base64url');
}
export function presenterToken(expires:number) { return expires+'.'+sign(String(expires)); }
export function presenterAuthorized(cookieValue?:string) {
 if(!process.env.AEGIS_PRESENTER_SECRET||!cookieValue||!/^[0-9]{10,14}\.[\w-]{43}$/.test(cookieValue))return false;
 const [expiry,tag]=cookieValue.split('.');
 return Number(expiry)>Date.now() && sameSecret(tag,sign(expiry));
}
