export function GET() {
  return Response.json({ ok: true, uid: process.getuid(), node: process.version });
}
