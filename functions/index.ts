export const onRequest = ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  return new Response(null, { status: 307, headers: { location: `/blox/${url.search}`, "cache-control": "no-store" } });
};
