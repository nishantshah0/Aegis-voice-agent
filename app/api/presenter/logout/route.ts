import {NextResponse} from 'next/server';
import {presenterCookie} from '@/lib/auth/presenter';
export async function POST(request:Request){
 const origin=process.env.AEGIS_PUBLIC_ORIGIN;
 if(!origin||request.headers.get('origin')!==origin)return new Response('Wrong origin',{status:403});
 const res=NextResponse.redirect(new URL('/present',origin),303);res.cookies.set(presenterCookie,'',{path:'/',httpOnly:true,secure:true,sameSite:'strict',maxAge:0});return res;
}
