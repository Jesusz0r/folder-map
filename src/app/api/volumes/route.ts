import { listMountedVolumes } from "@/lib/volumes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const listed = await listMountedVolumes();
    return Response.json(listed);
  } catch (error) {
    console.error(error);
    return Response.json(
      { volumes: [], error: "Mounted volumes could not be listed." },
      { status: 500 },
    );
  }
}
