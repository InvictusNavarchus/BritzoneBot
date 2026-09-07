import {
	type CommandInteraction,
	MessageFlags,
	type RepliableInteraction,
} from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import {
	handleInteraction,
	type InteractionContext,
	replyOrEdit,
	sendPublicAnnouncement,
} from '@/lib/discord/response.js';

describe('Discord Response Utilities (response.ts)', () => {
	describe('handleInteraction', () => {
		it('executes handler successfully when deferReply is false', async () => {
			const mockInteraction = {
				id: 'int-1',
				replied: false,
				deferred: false,
			} as unknown as RepliableInteraction;

			const mockHandler = vi.fn().mockResolvedValue(undefined);

			const success = await handleInteraction(mockInteraction, mockHandler);

			expect(success).toBe(true);
			expect(mockHandler).toHaveBeenCalledOnce();
		});

		it('defers reply when deferReply option is true', async () => {
			const deferReplyMock = vi.fn().mockResolvedValue(undefined);
			const mockInteraction = {
				id: 'int-1',
				replied: false,
				deferred: false,
				deferReply: deferReplyMock,
			} as unknown as RepliableInteraction;

			const mockHandler = vi.fn().mockResolvedValue(undefined);

			const success = await handleInteraction(mockInteraction, mockHandler, {
				deferReply: true,
			});

			expect(deferReplyMock).toHaveBeenCalledOnce();
			expect(mockHandler).toHaveBeenCalledOnce();
			expect(success).toBe(true);
		});

		it('handles expired interaction error (code 10062) gracefully', async () => {
			const expiredError = new Error('Unknown Interaction');
			(expiredError as Error & { code: number }).code = 10062;

			const mockInteraction = {
				id: 'int-1',
				replied: false,
				deferred: false,
				deferReply: vi.fn().mockRejectedValue(expiredError),
			} as unknown as RepliableInteraction;

			const mockHandler = vi.fn();

			const success = await handleInteraction(mockInteraction, mockHandler, {
				deferReply: true,
			});

			expect(success).toBe(false);
			expect(mockHandler).not.toHaveBeenCalled();
		});

		it('provides InteractionContext to the handler with working helper methods', async () => {
			const replyMock = vi.fn().mockResolvedValue({
				resource: { message: { id: 'msg-1' } },
			});
			const mockInteraction = {
				id: 'int-1',
				replied: false,
				deferred: false,
				reply: replyMock,
			} as unknown as RepliableInteraction;

			let receivedCtx: InteractionContext | undefined;
			const success = await handleInteraction(
				mockInteraction,
				async (ctx) => {
					receivedCtx = ctx;
					await ctx.reply('Hello from context');
				},
				{ ephemeral: true },
			);

			expect(success).toBe(true);
			expect(receivedCtx).toBeDefined();
			expect(receivedCtx?.interaction).toBe(mockInteraction);
			expect(receivedCtx?.isEphemeral).toBe(true);
			expect(receivedCtx?.isDeferred).toBe(false);
			expect(replyMock).toHaveBeenCalledWith({
				content: 'Hello from context',
				flags: MessageFlags.Ephemeral,
				withResponse: true,
			});
		});

		it('defers reply with Ephemeral flag when deferReply and ephemeral are true', async () => {
			const deferReplyMock = vi.fn().mockResolvedValue(undefined);
			const mockInteraction = {
				id: 'int-1',
				replied: false,
				deferred: false,
				deferReply: deferReplyMock,
			} as unknown as RepliableInteraction;

			const mockHandler = vi.fn().mockResolvedValue(undefined);

			const success = await handleInteraction(mockInteraction, mockHandler, {
				deferReply: true,
				ephemeral: true,
			});

			expect(deferReplyMock).toHaveBeenCalledWith({
				flags: MessageFlags.Ephemeral,
			});
			expect(mockHandler).toHaveBeenCalledOnce();
			expect(success).toBe(true);
		});

		it('handles handler timeout correctly and notifies user', async () => {
			vi.useFakeTimers();
			const replyMock = vi.fn().mockResolvedValue({ id: 'msg-err' });
			const mockInteraction = {
				id: 'int-1',
				replied: false,
				deferred: false,
				reply: replyMock,
			} as unknown as RepliableInteraction;

			const longRunningHandler = () =>
				new Promise<void>((resolve) => {
					setTimeout(resolve, 5000);
				});

			const handlePromise = handleInteraction(
				mockInteraction,
				longRunningHandler,
				{ handlerTimeoutMs: 1000, errorMessage: 'Timed out' },
			);

			await vi.advanceTimersByTimeAsync(1500);
			const success = await handlePromise;

			expect(success).toBe(false);
			expect(replyMock).toHaveBeenCalledWith({
				content: 'Timed out',
				withResponse: true,
			});
			vi.useRealTimers();
		});

		it('restartTimeout gives the work after a wait its own full budget', async () => {
			vi.useFakeTimers();
			const replyMock = vi.fn().mockResolvedValue({ id: 'msg-ok' });
			const mockInteraction = {
				id: 'int-1',
				replied: false,
				deferred: false,
				reply: replyMock,
			} as unknown as RepliableInteraction;

			// Models distribute: a long idle wait for a button click, then work
			// that on its own fits the budget. Together they exceed it.
			const handler = async (ctx: {
				restartTimeout: () => void;
			}): Promise<void> => {
				await new Promise((resolve) => setTimeout(resolve, 800));
				ctx.restartTimeout();
				await new Promise((resolve) => setTimeout(resolve, 800));
			};

			const handlePromise = handleInteraction(mockInteraction, handler, {
				handlerTimeoutMs: 1000,
				errorMessage: 'Timed out',
			});

			await vi.advanceTimersByTimeAsync(2000);

			expect(await handlePromise).toBe(true);
			expect(replyMock).not.toHaveBeenCalled();
			vi.useRealTimers();
		});

		it('still times out work that overruns after a restart', async () => {
			vi.useFakeTimers();
			const replyMock = vi.fn().mockResolvedValue({ id: 'msg-err' });
			const mockInteraction = {
				id: 'int-1',
				replied: false,
				deferred: false,
				reply: replyMock,
			} as unknown as RepliableInteraction;

			const handler = async (ctx: {
				restartTimeout: () => void;
			}): Promise<void> => {
				await new Promise((resolve) => setTimeout(resolve, 500));
				ctx.restartTimeout();
				await new Promise((resolve) => setTimeout(resolve, 5000));
			};

			const handlePromise = handleInteraction(mockInteraction, handler, {
				handlerTimeoutMs: 1000,
				errorMessage: 'Timed out',
			});

			await vi.advanceTimersByTimeAsync(2000);

			expect(await handlePromise).toBe(false);
			expect(replyMock).toHaveBeenCalledWith({
				content: 'Timed out',
				withResponse: true,
			});
			vi.useRealTimers();
		});

		it('handles deferReply timeout correctly and aborts handler', async () => {
			vi.useFakeTimers();
			const neverSettlingDefer = () => new Promise<void>(() => {});
			const mockInteraction = {
				id: 'int-1',
				replied: false,
				deferred: false,
				deferReply: neverSettlingDefer,
			} as unknown as RepliableInteraction;

			const mockHandler = vi.fn();

			const handlePromise = handleInteraction(mockInteraction, mockHandler, {
				deferReply: true,
				deferTimeoutMs: 500,
			});

			await vi.advanceTimersByTimeAsync(1000);
			const success = await handlePromise;

			expect(success).toBe(false);
			expect(mockHandler).not.toHaveBeenCalled();
			vi.useRealTimers();
		});

		it('notifies the user on handler error when notifyOnError is true', async () => {
			const replyMock = vi.fn().mockResolvedValue({ id: 'msg-err' });
			const mockInteraction = {
				id: 'int-1',
				replied: false,
				deferred: false,
				reply: replyMock,
			} as unknown as RepliableInteraction;

			const success = await handleInteraction(
				mockInteraction,
				async () => {
					throw new Error('Something broke');
				},
				{ notifyOnError: true, errorMessage: 'Custom error message' },
			);

			expect(success).toBe(false);
			expect(replyMock).toHaveBeenCalledWith({
				content: 'Custom error message',
				withResponse: true,
			});
		});

		it('does not send notification on handler error when notifyOnError is false', async () => {
			const replyMock = vi.fn();
			const mockInteraction = {
				id: 'int-1',
				replied: false,
				deferred: false,
				reply: replyMock,
			} as unknown as RepliableInteraction;

			const success = await handleInteraction(
				mockInteraction,
				async () => {
					throw new Error('Silent failure');
				},
				{ notifyOnError: false },
			);

			expect(success).toBe(false);
			expect(replyMock).not.toHaveBeenCalled();
		});
	});

	describe('replyOrEdit', () => {
		it('calls editReply when interaction is already replied', async () => {
			const editReplyMock = vi.fn().mockResolvedValue({ id: 'msg-1' });
			const replyMock = vi.fn();

			const mockInteraction = {
				replied: true,
				deferred: false,
				editReply: editReplyMock,
				reply: replyMock,
			} as unknown as CommandInteraction;

			await replyOrEdit(mockInteraction, 'Hello World');

			expect(editReplyMock).toHaveBeenCalledWith('Hello World');
			expect(replyMock).not.toHaveBeenCalled();
		});

		it('calls editReply when interaction is deferred', async () => {
			const editReplyMock = vi.fn().mockResolvedValue({ id: 'msg-1' });
			const replyMock = vi.fn();

			const mockInteraction = {
				replied: false,
				deferred: true,
				editReply: editReplyMock,
				reply: replyMock,
			} as unknown as CommandInteraction;

			await replyOrEdit(mockInteraction, { content: 'Deferred response' });

			expect(editReplyMock).toHaveBeenCalledWith({
				content: 'Deferred response',
			});
			expect(replyMock).not.toHaveBeenCalled();
		});

		it('calls reply with withResponse: true when interaction is fresh', async () => {
			const replyMock = vi.fn().mockResolvedValue({ id: 'msg-1' });
			const editReplyMock = vi.fn();

			const mockInteraction = {
				replied: false,
				deferred: false,
				reply: replyMock,
				editReply: editReplyMock,
			} as unknown as CommandInteraction;

			await replyOrEdit(mockInteraction, 'Fresh response');

			expect(replyMock).toHaveBeenCalledWith({
				content: 'Fresh response',
				withResponse: true,
			});
			expect(editReplyMock).not.toHaveBeenCalled();
		});

		it('normalizes ephemeral: true to MessageFlags.Ephemeral when fresh', async () => {
			const replyMock = vi.fn().mockResolvedValue({ id: 'msg-1' });
			const mockInteraction = {
				replied: false,
				deferred: false,
				reply: replyMock,
			} as unknown as CommandInteraction;

			await replyOrEdit(mockInteraction, {
				content: 'Private message',
				ephemeral: true,
			});

			expect(replyMock).toHaveBeenCalledWith({
				content: 'Private message',
				flags: MessageFlags.Ephemeral,
				withResponse: true,
			});
		});
	});

	describe('sendPublicAnnouncement', () => {
		it('sends message to channel when channel is sendable', async () => {
			const sendMock = vi.fn().mockResolvedValue({ id: 'msg-pub-1' });
			const mockInteraction = {
				id: 'int-1',
				channel: {
					send: sendMock,
				},
			} as unknown as CommandInteraction;

			const result = await sendPublicAnnouncement(mockInteraction, {
				content: 'Public announcement',
			});

			expect(sendMock).toHaveBeenCalledWith({ content: 'Public announcement' });
			expect(result).toEqual({ id: 'msg-pub-1' });
		});

		it('returns null gracefully when channel is null or lacks send method', async () => {
			const mockInteraction = {
				id: 'int-1',
				channel: null,
			} as unknown as CommandInteraction;

			const result = await sendPublicAnnouncement(
				mockInteraction,
				'Test content',
			);

			expect(result).toBeNull();
		});

		it('returns null gracefully when send method throws an error', async () => {
			const sendMock = vi
				.fn()
				.mockRejectedValue(new Error('Missing Permissions'));
			const mockInteraction = {
				id: 'int-1',
				channel: {
					send: sendMock,
				},
			} as unknown as CommandInteraction;

			const result = await sendPublicAnnouncement(
				mockInteraction,
				'Test content',
			);

			expect(sendMock).toHaveBeenCalledWith('Test content');
			expect(result).toBeNull();
		});
	});
});
