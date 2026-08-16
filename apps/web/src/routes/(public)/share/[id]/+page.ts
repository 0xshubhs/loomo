import type { PageLoad } from './$types';

// A universal load rather than a server load: it still runs on the server for
// the web deployment's SSR pass, but the desktop build has no server, and a
// `+page.server.ts` cannot exist in a static bundle.
export const load: PageLoad = async ({ params, fetch }) => {
	try {
		const res = await fetch(`/api/share/${params.id}`);
		if (!res.ok) throw new Error('not found');
		const raw = await res.json();

		// Normalize the API response for the page component
		const video = {
			...raw,
			author_name: raw.creator?.name ?? raw.author_name ?? null,
			author_avatar: raw.creator?.avatar_url ?? raw.author_avatar ?? null,
		};

		return {
			video,
			reactions: raw.reactions ?? [],
			comments: raw.comments ?? [],
		};
	} catch {
		return { video: null, reactions: [], comments: [] };
	}
};
