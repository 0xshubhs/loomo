<script lang="ts">
	import { getAuth } from '$lib/state/context.js';
	import { signup } from '$lib/api/auth.js';
	import { goto } from '$app/navigation';

	const auth = getAuth();
	let name = $state('');
	let email = $state('');
	let password = $state('');
	let error = $state<string | null>(null);
	let loading = $state(false);

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!name || !email || !password) return;
		if (password.length < 8) { error = 'Password must be at least 8 characters'; return; }
		loading = true;
		error = null;
		try {
			const res = await signup(email, password, name);
			auth.setSession(
				{ id: res.user.id, email: res.user.email, name: res.user.name, avatarUrl: res.user.avatar_url },
				res.access_token,
				res.refresh_token
			);
			goto('/');
		} catch (err: any) {
			error = err.message || 'Signup failed';
		} finally {
			loading = false;
		}
	}
</script>

<div class="auth-card">
	<h1 class="auth-title">Create your account</h1>

	{#if error}
		<div class="auth-error">{error}</div>
	{/if}

	<form onsubmit={handleSubmit}>
		<div class="field">
			<label for="name">Name</label>
			<input id="name" type="text" bind:value={name} required placeholder="Your name" />
		</div>
		<div class="field">
			<label for="email">Email</label>
			<input id="email" type="email" bind:value={email} required placeholder="you@example.com" />
		</div>
		<div class="field">
			<label for="password">Password</label>
			<input id="password" type="password" bind:value={password} required placeholder="Min 8 characters" />
		</div>
		<button type="submit" class="submit-btn" disabled={loading}>
			{loading ? 'Creating account...' : 'Sign up'}
		</button>
	</form>

	<p class="auth-footer">
		Already have an account? <a href="/login">Log in</a>
	</p>
</div>

<style>
	.auth-card {
		width: 380px;
		padding: 40px;
		background: var(--bg-secondary);
		border: 1px solid var(--border-primary);
		border-radius: 12px;
	}
	.auth-title {
		font-size: 22px;
		font-weight: 600;
		text-align: center;
		margin-bottom: 28px;
		color: var(--text-primary);
	}
	.auth-error {
		padding: 10px;
		margin-bottom: 16px;
		background: rgba(255, 68, 68, 0.1);
		border: 1px solid rgba(255, 68, 68, 0.3);
		border-radius: var(--radius-md);
		font-size: 13px;
		color: var(--danger);
	}
	.field { margin-bottom: 16px; }
	.field label {
		display: block;
		font-size: 12px;
		color: var(--text-secondary);
		margin-bottom: 6px;
	}
	.field input {
		width: 100%;
		padding: 10px 12px;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-primary);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		font-size: 14px;
	}
	.field input:focus { border-color: var(--border-focus); outline: none; }
	.field input::placeholder { color: var(--text-muted); }
	.submit-btn {
		width: 100%;
		padding: 12px;
		background: white;
		border: none;
		border-radius: var(--radius-md);
		color: black;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		margin-top: 8px;
	}
	.submit-btn:hover { opacity: 0.9; }
	.submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.auth-footer {
		text-align: center;
		margin-top: 20px;
		font-size: 13px;
		color: var(--text-secondary);
	}
	.auth-footer a { color: var(--text-primary); text-decoration: underline; }
</style>
