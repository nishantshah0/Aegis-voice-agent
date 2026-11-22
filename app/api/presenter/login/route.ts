import {NextResponse} from 'next/server';
import {presenterCookie,presenterToken,sameSecret,presenterDestination} from '@/lib/auth/presenter';
export async function POST(request:Request) {
 const origin=process.env.AEGIS_PUBLIC_ORIGIN, pass=process.env.AEGIS_PRESENTER_PASSCODE;
 if(!origin || !pass || !process.env.AEGIS_PRESENTER_SECRET || request.headers.get('origin')!==origin) return new Response('Presenter sign-in unavailable',{status:403});
 const body=await request.formData();const entered=body.get('passcode');
 const next=body.get('next');
 const destination=presenterDestination(next);
 if(typeof entered!=='string'||entered.length>200||!sameSecret(entered,pass)){
   const retry=new URL('/present?error=invalid',origin);
   if(destination!=='/present'&&typeof next==='string')retry.searchParams.set('next',next);
   return NextResponse.redirect(retry,303);
 }
 const response=NextResponse.redirect(new URL(destination,origin),303);
 response.cookies.set(presenterCookie,presenterToken(Date.now()+8*3600000),{httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:8*3600});
 response.headers.set('Cache-Control','no-store');return response;
}
