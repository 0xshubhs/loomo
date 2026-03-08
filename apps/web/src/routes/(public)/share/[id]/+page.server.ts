import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, fetch }) => {
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
