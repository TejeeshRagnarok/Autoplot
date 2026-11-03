/**
 * AutoPlot Layout Editor Undo/Redo History Manager
 * Uses immutable snapshot history with drag-coalescing:
 * Continuous pointer/drag updates do not create individual history steps;
 * instead, a step is committed only when the drag ends or an explicit edit completes.
 */

import { cloneLayout } from './layoutModel.js';

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
    // Layouts are treated as immutable, so the preview needs no deep copy per move.
    this.current = newLayout;
  }

  /**
   * Called when a continuous drag interaction ends: commits a single history action
   */
  endDrag(finalLayout) {
    if (this.isDragging) {
      // A click or a drag that ended where it started is not an undo step
      const unchanged = this.dragSnapshot && JSON.stringify(this.dragSnapshot) === JSON.stringify(finalLayout);
      if (this.dragSnapshot && !unchanged) {
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
   * Abandon a drag: restore the layout from before the drag without adding a
   * history step. Returns the restored layout.
   */
  cancelDrag() {
    if (this.isDragging && this.dragSnapshot) {
      this.current = this.dragSnapshot;
    }
    this.isDragging = false;
    this.dragSnapshot = null;
    return cloneLayout(this.current);
  }

  /**
   * Push an explicit mutation (e.g. add/delete element, property input change)
   */
  pushState(newLayout) {
    // An edit committed mid-drag still undoes back to before the drag started.
    const base = this.isDragging && this.dragSnapshot ? this.dragSnapshot : cloneLayout(this.current);
    this.isDragging = false;
    this.dragSnapshot = null;
    this.undoStack.push(base);
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
    // A drag in progress owns the layout: it must finish or cancel first.
    if (this.isDragging || !this.canUndo()) return cloneLayout(this.current);
    const previous = this.undoStack.pop();
    this.redoStack.push(cloneLayout(this.current));
    this.current = previous;
    return cloneLayout(this.current);
  }

  redo() {
    if (this.isDragging || !this.canRedo()) return cloneLayout(this.current);
    const next = this.redoStack.pop();
    this.undoStack.push(cloneLayout(this.current));
    this.current = next;
    return cloneLayout(this.current);
  }

  getCurrent() {
    return this.current;
  }
}
