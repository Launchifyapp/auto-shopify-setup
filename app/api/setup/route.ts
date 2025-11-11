import { NextRequest, NextResponse } from "next/server";
import { runFullSetup } from "../../../lib/setup"; // import relatif

export async function POST(req: NextRequest) {
  const { shop, token } = await req.json();
  try {
    await runFullSetup({ shop, token });
    return NextResponse.json({ ok: true, status: "done" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
