import { NextRequest } from "next/server";
import { ScanError, scanDirectory } from "@/lib/scan-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get("path");
  try {
    const result = await scanDirectory(requested);
    return Response.json(result);
  } catch (error) {
    if (error instanceof ScanError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error(error);
    return Response.json(
      { error: "The scan failed before it could finish." },
      { status: 500 },
    );
  }
}
