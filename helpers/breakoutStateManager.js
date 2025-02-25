import fs from 'fs/promises';
import path from 'path';

/**
 * Manages state persistence for breakout room operations to enable recovery
 * from network interruptions or other failures.
 */
class BreakoutStateManager {
  constructor() {
    this.statePath = path.join(process.cwd(), 'data');
    this.stateFile = path.join(this.statePath, 'breakoutState.json');
    this.inMemoryState = {};
    this.initialized = false;
  }

  /**
   * Initialize the state manager, ensuring the data directory exists
   * and loading any existing state
   */
  async initialize() {
    if (this.initialized) return;

    try {
      await fs.mkdir(this.statePath, { recursive: true });
      await this.loadState();
      this.initialized = true;
      console.log('📂 BreakoutStateManager initialized');
    } catch (error) {
      console.error('❌ Failed to initialize BreakoutStateManager:', error);
    }
  }

  /**
   * Load state from disk
   */
  async loadState() {
    try {
      const data = await fs.readFile(this.stateFile, 'utf8');
      this.inMemoryState = JSON.parse(data);
      console.log('📤 Loaded breakout state data');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('❌ Error loading breakout state:', error);
      }
      this.inMemoryState = {};
      console.log('🆕 Created new breakout state data');
    }
  }

  /**
   * Save state to disk
   */
  async saveState() {
    try {
      await this.initialize();
      await fs.writeFile(this.stateFile, JSON.stringify(this.inMemoryState, null, 2));
      console.log('💾 Saved breakout state data');
    } catch (error) {
      console.error('❌ Error saving breakout state:', error);
    }
  }

  /**
   * Start tracking a new operation
   */
  async startOperation(guildId, operationType, params) {
    await this.initialize();
    if (!this.inMemoryState[guildId]) {
      this.inMemoryState[guildId] = {};
    }

    this.inMemoryState[guildId].currentOperation = {
      type: operationType,
      params,
      progress: {
        started: true,
        completed: false,
        steps: {},
        startTime: Date.now()
      }
    };

    console.log(`📝 Started tracking ${operationType} operation for guild ${guildId}`);
    await this.saveState();
  }

  /**
   * Update progress for an operation
   */
  async updateProgress(guildId, step, data = {}) {
    await this.initialize();
    if (!this.inMemoryState[guildId]?.currentOperation) {
      console.log(`⚠️ No operation in progress for guild ${guildId}`);
      return false;
    }

    this.inMemoryState[guildId].currentOperation.progress.steps[step] = {
      completed: true,
      timestamp: Date.now(),
      ...data
    };

    console.log(`✅ Updated progress for guild ${guildId}: ${step}`);
    await this.saveState();
    return true;
  }

  /**
   * Complete an operation
   */
  async completeOperation(guildId) {
    await this.initialize();
    if (!this.inMemoryState[guildId]?.currentOperation) return;

    this.inMemoryState[guildId].currentOperation.progress.completed = true;
    this.inMemoryState[guildId].currentOperation.progress.completedTime = Date.now();
    
    // Move current operation to history
    if (!this.inMemoryState[guildId].history) {
      this.inMemoryState[guildId].history = [];
    }
    
    this.inMemoryState[guildId].history.push(
      this.inMemoryState[guildId].currentOperation
    );
    
    // Clear current operation
    delete this.inMemoryState[guildId].currentOperation;
    
    console.log(`🏁 Completed operation for guild ${guildId}`);
    await this.saveState();
  }

  /**
   * Check if there's an operation in progress
   */
  async hasOperationInProgress(guildId) {
    await this.initialize();
    return !!this.inMemoryState[guildId]?.currentOperation && 
           !this.inMemoryState[guildId].currentOperation.progress.completed;
  }

  /**
   * Get the current operation details
   */
  async getCurrentOperation(guildId) {
    await this.initialize();
    return this.inMemoryState[guildId]?.currentOperation;
  }

  /**
   * Get completed steps for the current operation
   */
  async getCompletedSteps(guildId) {
    await this.initialize();
    if (!this.inMemoryState[guildId]?.currentOperation) return {};
    return this.inMemoryState[guildId].currentOperation.progress.steps;
  }

  /**
   * Clear state for a guild
   */
  async clearGuildState(guildId) {
    await this.initialize();
    delete this.inMemoryState[guildId];
    await this.saveState();
    console.log(`🧹 Cleared state data for guild ${guildId}`);
  }
}

// Export a singleton instance
const stateManager = new BreakoutStateManager();
export default stateManager;
