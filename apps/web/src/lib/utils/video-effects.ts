/**
 * Build CSS filter/transform strings for video effects.
 * These are applied on top of clip filters in the preview renderer.
 */

export interface VideoEffectCss {
	filter: string;
	transform: string;
	mixBlendMode: string;
	animation: string;
}

export function buildVideoEffectCss(
	effectType: string,
	intensity: number,
	time: number
): VideoEffectCss {
	const t = intensity / 100; // 0.0 - 1.0
	const result: VideoEffectCss = {
		filter: '',
		transform: '',
		mixBlendMode: 'normal',
		animation: '',
	};

	switch (effectType) {
		case 'blur':
			result.filter = `blur(${t * 10}px)`;
			break;

		case 'vhs': {
			const scanlineOffset = Math.sin(time * 30) * t * 3;
			result.filter = `saturate(${1.2 + t * 0.5}) contrast(${1.1 + t * 0.2}) brightness(${1 + t * 0.1})`;
			result.transform = `translateX(${scanlineOffset}px)`;
			break;
		}

		case 'glitch': {
			const glitchX = (Math.random() - 0.5) * t * 10;
			const glitchSkew = (Math.random() - 0.5) * t * 5;
			result.transform = `translateX(${glitchX}px) skewX(${glitchSkew}deg)`;
			result.filter = `hue-rotate(${Math.random() * t * 90}deg)`;
			break;
		}

		case 'filmic':
			result.filter = `sepia(${t * 0.4}) contrast(${1.1 + t * 0.2}) brightness(${0.95 - t * 0.05}) saturate(${0.8 + t * 0.1})`;
			break;

		case 'glow':
			result.filter = `brightness(${1 + t * 0.3}) contrast(${0.95}) blur(${t * 1.5}px)`;
			break;

		case 'vaporwave':
			result.filter = `hue-rotate(${180 + t * 60}deg) saturate(${1.5 + t * 0.5}) contrast(${1.1})`;
			break;

		case 'flash': {
			const flashIntensity = Math.abs(Math.sin(time * (2 + t * 6)));
			result.filter = `brightness(${1 + flashIntensity * t * 2})`;
			break;
		}

		case 'pulse': {
			const pulseScale = 1 + Math.sin(time * (3 + t * 4)) * t * 0.05;
			result.transform = `scale(${pulseScale})`;
			break;
		}

		case 'kaleidoscope':
			// CSS can't do true kaleidoscope, but we can approximate with rotate + scale
			result.transform = `rotate(${Math.sin(time) * t * 5}deg)`;
			result.filter = `hue-rotate(${time * 30 * t}deg) saturate(${1.3})`;
			break;

		case 'bokeh':
			result.filter = `blur(${t * 3}px) brightness(${1.1 + t * 0.15}) saturate(${1.2})`;
			break;

		case 'mirror':
			result.transform = `scaleX(-1)`;
			break;

		case 'cinematic':
			result.filter = `contrast(${1.15 + t * 0.15}) saturate(${0.8 + t * 0.1}) brightness(${0.95})`;
			break;
	}

	return result;
}
