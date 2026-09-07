import type { VoiceBasedChannel, VoiceChannel } from 'discord.js';
import { describe, expect, it } from 'vitest';
import type { TimerData } from '@/modules/breakout/state/state.js';
import { formatBreakoutStatus } from '@/modules/breakout/utils/status.js';

const fakeMainRoom = (id: string, memberCount: number = 0): VoiceBasedChannel =>
	({
		id,
		members: { size: memberCount },
	}) as unknown as VoiceBasedChannel;

const fakeRoom = (id: string, memberCount: number = 0): VoiceChannel =>
	({
		id,
		members: { size: memberCount },
	}) as unknown as VoiceChannel;

describe('formatBreakoutStatus', () => {
	const baseStartTime = 1720000000000;

	it('formats status when no rooms exist and no timer is running', () => {
		const result = formatBreakoutStatus({
			mainRoom: undefined,
			breakoutRooms: [],
			timerData: null,
		});

		expect(result).toContain('📊 **Breakout Session Status**');
		expect(result).toContain('• **Main Room:** *None configured*');
		expect(result).toContain(
			'• **Breakout Rooms:** *No breakout rooms created*',
		);
		expect(result).toContain('• **Status:** ⚪ No active timer');
	});

	it('formats status with main room, breakout rooms, and member counts', () => {
		const mainRoom = fakeMainRoom('main-1', 4);
		const breakoutRooms = [fakeRoom('room-1', 3), fakeRoom('room-2', 5)];

		const result = formatBreakoutStatus({
			mainRoom,
			breakoutRooms,
			timerData: null,
		});

		expect(result).toContain('• **Main Room:** <#main-1> (4 members)');
		expect(result).toContain('<#room-1> (3)');
		expect(result).toContain('<#room-2> (5)');
		expect(result).toContain('• **Total Rooms:** 2 (8 members total)');
		expect(result).toContain('• **Status:** ⚪ No active timer');
	});

	it('formats status with active timer and reminders', () => {
		const mainRoom = fakeMainRoom('main-1', 2);
		const breakoutRooms = [fakeRoom('room-1', 3)];
		const timerData: TimerData = {
			guildId: 'guild-1',
			startTime: baseStartTime,
			totalMinutes: 45,
			breakoutRooms: ['room-1'],
			sentReminders: [22],
			autoRecall: true,
			mainRoomId: 'main-1',
			gracePeriodSeconds: 60,
		};

		const now = baseStartTime + 25 * 60 * 1000;
		const result = formatBreakoutStatus({
			mainRoom,
			breakoutRooms,
			timerData,
			now,
		});

		expect(result).toContain('• **Main Room:** <#main-1> (2 members)');
		expect(result).toContain('⏱️ **Breakout Timer Status**');
		expect(result).toContain('• **Status:** 🟢 Active');
		expect(result).toContain('• **Duration:** 45 minutes');
		expect(result).toContain('✅ 22m (sent)');
		expect(result).toContain('⏳ 10m (pending)');
	});

	it('formats status with active operation in progress', () => {
		const result = formatBreakoutStatus({
			mainRoom: undefined,
			breakoutRooms: [],
			timerData: null,
			currentOperationType: 'distribute',
		});

		expect(result).toContain('• **Operation in Progress:** ⚠️ `distribute`');
	});

	it('truncates room list when it would exceed character limit', () => {
		// Create enough rooms to exceed the 1500 char limit for room details
		// Each room is approximately "<#room-XXXX> (Y), " ≈ 20-25 chars
		// We need ~80+ rooms to exceed 1500 chars
		const manyRooms = Array.from({ length: 100 }, (_, i) =>
			fakeRoom(`room-${i.toString().padStart(5, '0')}`, i % 10),
		);

		const result = formatBreakoutStatus({
			mainRoom: undefined,
			breakoutRooms: manyRooms,
			timerData: null,
		});

		// Verify the result stays under Discord's 2000 char limit
		expect(result.length).toBeLessThan(2000);

		// Verify total room count is preserved
		expect(result).toContain('• **Total Rooms:** 100');

		// Verify truncation notice is present
		expect(result).toContain('showing');
		expect(result).toContain('/100 rooms');

		// Calculate expected total members
		const totalMembers = Array.from({ length: 100 }, (_, i) => i % 10).reduce(
			(a, b) => a + b,
			0,
		);
		expect(result).toContain(`(${totalMembers} members total)`);
	});
});
