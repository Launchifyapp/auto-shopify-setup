import { NextRequest, NextResponse } from "next/server";
import { runFullSetup } from "../../../lib/setup";

export async function POST(req: NextRequest) {
  const { shop, token } = await req.json();
  try {
    await runFullSetup({ shop, token });
    return NextResponse.json({ ok: true, status: "done" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const shop = searchParams.get("shop");
  const token = searchParams.get("token");
  if (!shop || !token) {
    return NextResponse.json({ ok: false, error: "Missing shop or token" }, { status: 400 });
  }
  try {
    await runFullSetup({ shop, token });
    return NextResponse.json({ ok: true, status: "done" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
