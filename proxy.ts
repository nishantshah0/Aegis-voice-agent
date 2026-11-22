import {NextRequest,NextResponse} from 'next/server';
import {presenterAuthorized,presenterCookie} from '@/lib/auth/presenter';
import { AUTH_ROUTES, getAuth0 } from '@/lib/auth/auth0';
import { approverFromUser } from '@/lib/auth/session';
const providerCallbacks=new Set(['/api/presenter/phone/twiml','/api/presenter/phone/event','/api/presenter/phone/clip']);
const noStore={'Cache-Control':'private, no-store'};
export async function proxy(request:NextRequest){
 const path=request.nextUrl.pathname;
 const origin=process.env.AEGIS_PUBLIC_ORIGIN;
 if (!origin) {
   if (process.env.VERCEL === "1" || process.env.AEGIS_PRESENTER_SECRET) return NextResponse.json({error:"Presenter server is not configured."},{status:503});
   if (path !== "/app" && !path.startsWith("/app/")) return NextResponse.next();
   const auth0=getAuth0();
   const session=auth0 ? await auth0.getSession(request).catch(()=>null) : null;
   if (approverFromUser(session?.user)) return NextResponse.next();
   if (session?.user) return NextResponse.redirect(new URL("/no-access",request.url));
   const login=new URL(AUTH_ROUTES.login,request.url);
   login.searchParams.set("returnTo",request.nextUrl.pathname+request.nextUrl.search);
   return NextResponse.redirect(login);
 }
 if(request.nextUrl.hostname!==new URL(origin).hostname)return NextResponse.redirect(new URL(path+request.nextUrl.search,origin),307);
 const headers=new Headers(request.headers);headers.delete('x-aegis-presenter');headers.delete('x-aegis-presenter-secret');
 const pass=(auth=false)=>{
  if(auth)headers.set('x-aegis-presenter',process.env.AEGIS_PRESENTER_SECRET!);
  headers.set('x-forwarded-host',new URL(origin).host);headers.set('x-forwarded-proto','https');
  return NextResponse.next({request:{headers}});
 };
 if(path==='/')return pass();
 if(path==='/api/presenter/login'||providerCallbacks.has(path)||path==='/present')return pass();
 const signed=presenterAuthorized(request.cookies.get(presenterCookie)?.value);
 if(!signed)return path.startsWith('/api/')?NextResponse.json({error:'Sign in on the presenter page.'},{status:401,headers:noStore}):NextResponse.redirect(new URL(path === '/app/pharmacy/today' ? '/present?next=pharmacy' : path === '/simulation' ? '/present?next=simulation' : path === '/stage' ? '/present?next=stage' : '/present',origin));
 if(!['GET','HEAD','OPTIONS'].includes(request.method)&&request.headers.get('origin')!==origin)return NextResponse.json({error:'Request must come from this demo.'},{status:403});
 if(path.startsWith('/api/arena/') || path.startsWith('/api/voice/') || path==='/api/rules/draft'){
   return NextResponse.json({error:'Use the hosted presenter controls for phone calls and the live business suite.'},{status:403,headers:noStore});
 }
 return pass(true);
}
export const config={matcher:['/','/present','/simulation/:path*','/app/:path*','/api/:path*','/phone/:path*','/stage/:path*','/console/:path*']};
