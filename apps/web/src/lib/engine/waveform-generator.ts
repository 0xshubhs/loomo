export async function generateWaveform(
	blobUrl: string,
	samples: number = 1000
): Promise<Float32Array> {
	try {
		const response = await fetch(blobUrl);
		const arrayBuffer = await response.arrayBuffer();

		const audioContext = new AudioContext();
		const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

		const channelData = audioBuffer.getChannelData(0);
		const blockSize = Math.floor(channelData.length / samples);
		const waveform = new Float32Array(samples);

		for (let i = 0; i < samples; i++) {
			const start = blockSize * i;
			let sum = 0;
			for (let j = 0; j < blockSize; j++) {
				sum += Math.abs(channelData[start + j] || 0);
			}
			waveform[i] = sum / blockSize;
		}

		await audioContext.close();
		return waveform;
	} catch {
		return new Float32Array(samples);
	}
}
