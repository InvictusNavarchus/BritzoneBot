import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	activePromptCount,
	disableActivePrompts,
	trackInteractivePrompt,
} from '@/lib/discord/components.js';

describe('interactive prompt registry (components.ts)', () => {
	beforeEach(async () => {
		await disableActivePrompts();
	});

	it('starts empty and tracks registered prompts', () => {
		expect(activePromptCount()).toBe(0);
		trackInteractivePrompt(async () => {});
		expect(activePromptCount()).toBe(1);
	});

	it('unregisters a prompt that resolved on its own', () => {
		const disable = vi.fn().mockResolvedValue(undefined);
		const untrack = trackInteractivePrompt(disable);

		untrack();

		expect(activePromptCount()).toBe(0);
		return disableActivePrompts().then(() => {
			expect(disable).not.toHaveBeenCalled();
		});
	});

	it('disables every outstanding prompt on shutdown', async () => {
		const first = vi.fn().mockResolvedValue(undefined);
		const second = vi.fn().mockResolvedValue(undefined);
		trackInteractivePrompt(first);
		trackInteractivePrompt(second);

		await disableActivePrompts();

		expect(first).toHaveBeenCalledTimes(1);
		expect(second).toHaveBeenCalledTimes(1);
		expect(activePromptCount()).toBe(0);
	});

	it('does not let one failing prompt block the others', async () => {
		// A message someone deleted must not stall shutdown for everyone else.
		const failing = vi.fn().mockRejectedValue(new Error('Unknown Message'));
		const healthy = vi.fn().mockResolvedValue(undefined);
		trackInteractivePrompt(failing);
		trackInteractivePrompt(healthy);

		await expect(disableActivePrompts()).resolves.toBeUndefined();
		expect(healthy).toHaveBeenCalledTimes(1);
	});

	it('is a no-op when nothing is outstanding', async () => {
		await expect(disableActivePrompts()).resolves.toBeUndefined();
	});
});
