import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, fetch }) => {
	try {
		const res = await fetch(`/api/share/${params.id}`);
		if (!res.ok) throw new Error('not found');
		const video = await res.json();
		return { video };
	} catch {
		return { video: null };
	}
};
