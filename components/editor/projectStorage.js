/**
 * AutoPlot Project Storage & Persistence
 * Manages local persistence, autosave debouncing, project metadata,
 * and authenticated user scoping.
 */

import { feetToInches, getPlotWallThicknesses } from './layoutModel.js';

const STORAGE_KEY_PREFIX = 'autoplot_project_';
const ACTIVE_PROJECT_KEY = 'autoplot_active_project_id';

export const SAVE_STATUS = {
  SAVED: 'saved',
  SAVING: 'saving',
  UNSAVED: 'unsaved',
  FAILED: 'failed',
};

const LAYOUT_LISTS = ['walls', 'rooms', 'doors', 'windows', 'staircases', 'columns', 'parking', 'utilities', 'dimensions', 'annotations', 'cadEntities'];

/**
 * Bring a loaded layout up to the current shape, so projects saved by older
 * versions open without losing anything.
 */
export function normalizeLoadedLayout(layout) {
  if (!layout || typeof layout !== 'object' || !layout.plot) return null;
  const next = { ...layout };
  for (const key of LAYOUT_LISTS) if (!Array.isArray(next[key])) next[key] = [];
  // Projects from before wall thickness was stored in inches kept it in feet only.
  next.walls = next.walls.map((w) => (w.thicknessInches === undefined ? { ...w, thicknessInches: feetToInches(w.thickness) } : w));
  next.plot = { ...next.plot, boundaryWalls: getPlotWallThicknesses(next) };
  return next;
}

/**
 * Save layout to local storage
 * @param {object} layout
 * @param {string} userId - Optional authenticated user ID
 * @returns {Promise<boolean>}
 */
export async function saveProject(layout, userId = 'default_user') {
  if (!layout) return false;
  try {
    const updated = {
      ...layout,
      updatedAt: new Date().toISOString(),
      ownerId: userId,
    };

    const key = `${STORAGE_KEY_PREFIX}${userId}_${layout.id || 'default'}`;
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, JSON.stringify(updated));
      window.localStorage.setItem(ACTIVE_PROJECT_KEY, key);
    }
    return true;
  } catch (err) {
    console.error('Error saving project to local storage:', err);
    return false;
  }
}

/**
 * Load latest saved layout for user
 * @param {string} projectId
 * @param {string} userId
 * @returns {object|null}
 */
export function loadProject(projectId = 'default', userId = 'default_user') {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const key = `${STORAGE_KEY_PREFIX}${userId}_${projectId}`;
      const data = window.localStorage.getItem(key);
      if (data) {
        return normalizeLoadedLayout(JSON.parse(data));
      }
    }
  } catch (err) {
    console.error('Error loading project:', err);
  }
  return null;
}

/**
 * Export layout object as a downloadable JSON file
 */
export function exportProjectJSON(layout) {
  if (typeof window === 'undefined') return;
  try {
    const filename = `${(layout.title || 'autoplot-layout').toLowerCase().replace(/\s+/g, '-')}.json`;
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(layout, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', filename);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  } catch (err) {
    console.error('Error exporting project JSON:', err);
  }
}
