import { NextRequest, NextResponse } from "next/server";
import { runFullSetup } from "@/lib/setup";


export async function POST(req: NextRequest) {
  const { shop, token } = await req.json();
  if (!shop || !token) return NextResponse.json({ ok:false, error:"shop & token requis" }, { status: 400 });
  await runFullSetup({ shop, token });
  return NextResponse.json({ ok:true });
}
