/**
 * AutoPlot Layout Editor Undo/Redo History Manager
 * Uses immutable snapshot history with drag-coalescing:
 * Continuous pointer/drag updates do not create individual history steps;
 * instead, a step is committed only when the drag ends or an explicit edit completes.
 */

import { cloneLayout } from './layoutModel';

export class HistoryManager {
  constructor(initialLayout, maxHistory = 50) {
    this.maxHistory = maxHistory;
    this.undoStack = [];
    this.redoStack = [];
    this.current = cloneLayout(initialLayout);
    this.isDragging = false;
    this.dragSnapshot = null;
  }

  /**
   * Reset with a new initial layout
   */
  reset(layout) {
    this.undoStack = [];
    this.redoStack = [];
    this.current = cloneLayout(layout);
    this.isDragging = false;
    this.dragSnapshot = null;
  }

  /**
   * Called when a continuous drag interaction starts
   */
  beginDrag() {
    if (!this.isDragging) {
      this.isDragging = true;
      this.dragSnapshot = cloneLayout(this.current);
    }
  }

  /**
   * Called on each pointer drag move: updates current without pushing history
   */
  updateDuringDrag(newLayout) {
    this.current = cloneLayout(newLayout);
  }

  /**
   * Called when a continuous drag interaction ends: commits a single history action
   */
  endDrag(finalLayout) {
    if (this.isDragging) {
      if (this.dragSnapshot) {
        this.undoStack.push(this.dragSnapshot);
        if (this.undoStack.length > this.maxHistory) {
          this.undoStack.shift();
        }
        this.redoStack = [];
      }
      this.current = cloneLayout(finalLayout);
      this.isDragging = false;
      this.dragSnapshot = null;
    }
  }

  /**
   * Push an explicit mutation (e.g. add/delete element, property input change)
   */
  pushState(newLayout) {
    if (this.isDragging) {
      this.isDragging = false;
      this.dragSnapshot = null;
    }
    this.undoStack.push(cloneLayout(this.current));
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.current = cloneLayout(newLayout);
    return this.current;
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    if (!this.canUndo()) return this.current;
    const previous = this.undoStack.pop();
    this.redoStack.push(cloneLayout(this.current));
    this.current = previous;
    return cloneLayout(this.current);
  }

  redo() {
    if (!this.canRedo()) return this.current;
    const next = this.redoStack.pop();
    this.undoStack.push(cloneLayout(this.current));
    this.current = next;
    return cloneLayout(this.current);
  }

  getCurrent() {
    return this.current;
  }
}
