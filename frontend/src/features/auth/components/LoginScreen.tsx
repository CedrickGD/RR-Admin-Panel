import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Lock, Server, UserRound } from 'lucide-react';
import type { LoginFormState } from '@/shared/types/dashboard';

type LoginScreenProps = {
	defaultBackendUrl: string;
	onSignIn: (form: LoginFormState) => void;
};

export function LoginScreen({ defaultBackendUrl, onSignIn }: LoginScreenProps) {
	const [form, setForm] = useState<LoginFormState>({
		username: localStorage.getItem('rr.admin.username') ?? 'admin',
		password: '',
		backendUrl: localStorage.getItem('rr.admin.backendUrl') ?? defaultBackendUrl,
		rememberMe: localStorage.getItem('rr.admin.rememberMe') === 'true',
	});

	const canSubmit = useMemo(
		() => form.username.trim().length > 0 && form.password.trim().length > 0 && form.backendUrl.trim().length > 0,
		[form],
	);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		onSignIn(form);
	};

	return (
		<div className="login-screen">
			<div className="login-screen__background" />
			<form className="login-panel" onSubmit={submit}>
				<p className="login-panel__eyebrow">Razor Reaper Control Layer</p>
				<h1>Admin Dashboard Access</h1>
				<p className="login-panel__subtitle">Authenticate session settings before entering the analytics panel.</p>

				<label>
					<span>Username</span>
					<div className="login-input">
						<UserRound size={16} />
						<input
							type="text"
							value={form.username}
							onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
							autoComplete="username"
						/>
					</div>
				</label>

				<label>
					<span>Password</span>
					<div className="login-input">
						<Lock size={16} />
						<input
							type="password"
							value={form.password}
							onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
							autoComplete="current-password"
						/>
					</div>
				</label>

				<label>
					<span>Backend URL</span>
					<div className="login-input">
						<Server size={16} />
						<input
							type="url"
							value={form.backendUrl}
							onChange={(event) => setForm((current) => ({ ...current, backendUrl: event.target.value }))}
						/>
					</div>
				</label>

				<label className="remember-toggle">
					<input
						type="checkbox"
						checked={form.rememberMe}
						onChange={(event) => setForm((current) => ({ ...current, rememberMe: event.target.checked }))}
					/>
					<span className="remember-toggle__visual" />
					<span>Remember me</span>
				</label>

				<button type="submit" className="sign-in-button" disabled={!canSubmit}>
					Sign In
				</button>
			</form>
		</div>
	);
}
