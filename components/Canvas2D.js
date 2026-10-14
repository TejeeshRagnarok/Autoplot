import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions, ScrollView, Platform } from 'react-native';
import { lightTheme as staticTheme } from '../constants/theme';
import { Ionicons } from '@expo/vector-icons';

export default function Canvas2D({ language, state, theme: propTheme, onOpenEditor, layoutData }) {
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const theme = propTheme || staticTheme;
  const styles = getStyles(theme);
  const isTe = language === 'te';

  // CAD Layer toggles & Scale state
  const [showGrid, setShowGrid] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showCirculation, setShowCirculation] = useState(false); // Default to FALSE to hide green walking lines
  const [showFurniture, setShowFurniture] = useState(true);
  const [scale, setScale] = useState(1.0); // Panning physical zoom factor

  // Parse Compass Orientation rotation angle
  const angle = parseFloat(state.compassAngle) || 0;

  // Geometry dimensions in Feet
  const siteL = parseFloat(state.siteLength) || 50;
  const siteW = parseFloat(state.siteWidth) || 30;
  const maxDim = Math.max(siteL, siteW);

  let eastO = parseFloat(state.eastOpen) || 0;
  let westO = parseFloat(state.westOpen) || 0;
  let northO = parseFloat(state.northOpen) || 0;
  let southO = parseFloat(state.southOpen) || 0;

  const minFootprintDim = 10.0; // 10 feet minimum building width/length

  // Dynamically scale down horizontal setbacks if they exceed available width minus building width
  if (westO + eastO > siteW - minFootprintDim) {
    const totalO = westO + eastO;
    const allowedO = siteW - minFootprintDim;
    const ratio = allowedO / Math.max(0.1, totalO);
    westO *= ratio;
    eastO *= ratio;
  }

  // Dynamically scale down vertical setbacks if they exceed available length minus building length
  if (northO + southO > siteL - minFootprintDim) {
    const totalO = northO + southO;
    const allowedO = siteL - minFootprintDim;
    const ratio = allowedO / Math.max(0.1, totalO);
    northO *= ratio;
    southO *= ratio;
  }

  // Buildable footprint area in Feet
  const footW = siteW - eastO - westO;
  const footL = siteL - northO - southO;

  // Scaled dimensions to occupy almost the entire screen (increased scale from 0.80 to 0.94)
  // On desktop view, account for the left navigation sidebar (240px) and right property panel (280px)
  const isDesktop = SCREEN_WIDTH > 990;
  const availableCanvasWidth = isDesktop ? SCREEN_WIDTH - 520 - 32 : SCREEN_WIDTH - 32;
  const plotWidth = (siteW / maxDim) * (availableCanvasWidth * 0.94);
  const plotHeight = (siteL / maxDim) * (availableCanvasWidth * 0.94);
  
  // Physical scale zoom: multiply base pixels-per-foot by the user-selected scale factor
  const basePxPerFt = plotWidth / siteW;
  const pxPerFt = basePxPerFt * scale;

  const currentPlotWidth = plotWidth * scale;
  const currentPlotHeight = plotHeight * scale;

  const footWidthPx = footW * pxPerFt;
  const footHeightPx = footL * pxPerFt;

  const westOpenPx = westO * pxPerFt;
  const eastOpenPx = eastO * pxPerFt;
  const northOpenPx = northO * pxPerFt;
  const southOpenPx = southO * pxPerFt;

  // Dynamic canvas height to fit everything and avoid any vertical overlaps
  const CANVAS_HEIGHT = Math.max(620, currentPlotHeight + 160);

  const getUtilityCoords = (location, utilityType) => {
    if (!location) return { x: 0, y: 0, w: 0, h: 0 };
    const pad = 12 * scale;
    const size = 32 * scale;
    const rightSide = currentPlotWidth - eastOpenPx - pad - size;
    const bottomSide = currentPlotHeight - southOpenPx - pad - size;

    let coord = { x: pad, y: pad };

    if (location.includes("Northeast")) {
      coord = { x: rightSide, y: pad };
    } else if (location.includes("Southeast")) {
      coord = { x: rightSide, y: bottomSide };
    } else if (location.includes("Southwest")) {
      coord = { x: pad, y: bottomSide };
    } else if (location.includes("Northwest")) {
      coord = { x: pad, y: pad };
    } else if (location.includes("North")) {
      coord = { x: currentPlotWidth / 2 - size / 2, y: pad };
    } else if (location.includes("South")) {
      coord = { x: currentPlotWidth / 2 - size / 2, y: bottomSide };
    } else if (location.includes("East")) {
      coord = { x: rightSide, y: currentPlotHeight / 2 - size / 2 };
    } else if (location.includes("West")) {
      coord = { x: pad, y: currentPlotHeight / 2 - size / 2 };
    }

    if (utilityType === 'sump') {
      coord.y += 38 * scale; 
    }

    return { ...coord, w: size, h: size };
  };

  // Helper to format room names cleanly inside small spaces to prevent clutter
  const getCleanRoomLabel = (fullName, wPx, hPx) => {
    if (!fullName) return "";
    if (wPx < 52 || hPx < 52) {
      const n = fullName.toLowerCase();
      if (n.includes("bedroom")) return "Bed";
      if (n.includes("kitchen")) return "Kit";
      if (n.includes("toilet") || n.includes("bathroom")) return "Bath";
      if (n.includes("pooja")) return "Pooja";
      if (n.includes("dining")) return "Dining";
      if (n.includes("living") || n.includes("hall")) return "Hall";
      if (n.includes("study")) return "Study";
      return fullName.substring(0, 5) + ".";
    }
    return fullName;
  };

  const renderRoomFurniture = (room) => {
    if (!showFurniture) return null;

    const name = room.name.toLowerCase();
    const rW_px = room.visW * pxPerFt;
    const rH_px = room.visH * pxPerFt;

    // Show furniture only if room has sufficient size to prevent overlaps
    if (rW_px < 35 || rH_px < 35) return null;

    const pad = 4 * scale;

    if (name.includes("bedroom") || name.includes("guest") || name.includes("study")) {
      const bW = Math.min(rW_px * 0.65, 6.0 * pxPerFt);
      const bH = Math.min(rH_px * 0.70, 6.5 * pxPerFt);
      const pilW = bW * 0.38;
      const pilH = Math.min(bH * 0.18, 1.2 * pxPerFt);
      const headH = Math.min(bH * 0.08, 0.4 * pxPerFt);
      const blankH = bH * 0.42;

      return (
        <View style={[styles.bedFurniture, { width: bW, height: bH, bottom: pad, right: pad }]}>
          <View style={styles.bedPillowsRow}>
            <View style={[styles.bedPillow, { width: pilW, height: pilH }]} />
            <View style={[styles.bedPillow, { width: pilW, height: pilH }]} />
          </View>
          <View style={[styles.bedHeadboard, { height: headH }]} />
          <View style={[styles.bedBlanket, { height: blankH }]} />
        </View>
      );
    }

    if (name.includes("kitchen")) {
      const cThick = Math.min(rW_px * 0.25, 2.0 * pxPerFt);
      const stoveW = Math.min(rW_px * 0.4, 2.5 * pxPerFt);
      const stoveH = Math.min(rH_px * 0.25, 1.6 * pxPerFt);
      const sinkSize = Math.min(rW_px * 0.3, 1.8 * pxPerFt);

      return (
        <View style={styles.furnitureOverlayContainer}>
          <View style={[styles.kitchenCounterV, { width: cThick, right: 0, top: 0, bottom: 0 }]} />
          <View style={[styles.kitchenCounterH, { height: cThick, bottom: 0, left: 0, right: 0 }]} />
          <View style={[styles.cooktopStove, { width: stoveW, height: stoveH, bottom: cThick + pad, right: pad }]} >
            <View style={[styles.burnerCircle, { width: 4 * scale, height: 4 * scale, borderRadius: 2 * scale }]} />
            <View style={[styles.burnerCircle, { width: 4 * scale, height: 4 * scale, borderRadius: 2 * scale }]} />
          </View>
          <View style={[styles.kitchenSink, { width: sinkSize, height: sinkSize, top: pad, right: pad }]} />
        </View>
      );
    }

    if (name.includes("toilet") || name.includes("bathroom")) {
      const comW = Math.min(rW_px * 0.38, 1.6 * pxPerFt);
      const comH = Math.min(rH_px * 0.45, 2.2 * pxPerFt);
      const tankW = comW * 0.88;
      const tankH = comH * 0.25;
      const bowlW = comW * 0.75;
      const bowlH = comH * 0.65;
      const basinSize = Math.min(rW_px * 0.3, 1.5 * pxPerFt);

      return (
        <View style={styles.furnitureOverlayContainer}>
          <View style={[styles.toiletCommode, { width: comW, height: comH, left: pad, top: pad }]}>
            <View style={[styles.toiletTank, { width: tankW, height: tankH }]} />
            <View style={[styles.toiletBowl, { width: bowlW, height: bowlH }]} />
          </View>
          <View style={[styles.washBasinCorner, { width: basinSize, height: basinSize, right: pad, top: pad }]} />
        </View>
      );
    }

    if (name.includes("living") || name.includes("hall") || name.includes("drawing")) {
      const sofaW1 = Math.min(rW_px * 0.22, 1.8 * pxPerFt);
      const sofaH2 = Math.min(rH_px * 0.22, 1.8 * pxPerFt);
      const tableW = Math.min(rW_px * 0.4, 2.8 * pxPerFt);
      const tableH = Math.min(rH_px * 0.3, 1.8 * pxPerFt);

      return (
        <View style={styles.furnitureOverlayContainer}>
          <View style={styles.sofaSectional}>
            <View style={[styles.sofaSeatLong, { width: sofaW1 }]} />
            <View style={[styles.sofaSeatShort, { left: sofaW1, top: 0, width: sofaW1 * 1.5, height: sofaH2 }]} />
          </View>
          <View style={[styles.coffeeTable, { width: tableW, height: tableH, left: sofaW1 * 1.8, top: sofaH2 * 1.5 }]} />
        </View>
      );
    }

    if (name.includes("dining")) {
      const tblW = rW_px * 0.55;
      const tblH = rH_px * 0.42;
      const chairSize = Math.min(rW_px * 0.08, 1.0 * pxPerFt);

      return (
        <View style={[styles.diningTableSet, { width: tblW, height: tblH, left: rW_px * 0.22, top: rH_px * 0.28 }]}>
          <View style={[styles.diningChairDot, { width: chairSize, height: chairSize, borderRadius: chairSize / 2 }]} />
          <View style={[styles.diningChairDot, { width: chairSize, height: chairSize, borderRadius: chairSize / 2 }]} />
          <View style={styles.diningTablePlate} />
          <View style={[styles.diningChairDot, { width: chairSize, height: chairSize, borderRadius: chairSize / 2 }]} />
          <View style={[styles.diningChairDot, { width: chairSize, height: chairSize, borderRadius: chairSize / 2 }]} />
        </View>
      );
    }

    if (name.includes("pooja")) {
      const pedSize = Math.min(rW_px * 0.4, 1.8 * pxPerFt);
      return (
        <View style={[styles.poojaPedestal, { width: pedSize, height: pedSize, right: pad, top: pad }]}>
          <Ionicons name="flame" size={Math.min(14, pedSize * 0.8)} color="#D97706" />
        </View>
      );
    }

    return null;
  };

  const getRoomIcon = (name) => {
    const n = name.toLowerCase();
    if (n.includes("pooja")) return "flame-outline";
    if (n.includes("kitchen")) return "restaurant-outline";
    if (n.includes("master")) return "bed-outline";
    if (n.includes("toilet") || n.includes("bathroom")) return "water-outline";
    if (n.includes("dining")) return "cafe-outline";
    if (n.includes("study")) return "book-outline";
    return "tv-outline";
  };

  const isPrivateRoom = (name) => {
    if (!name) return false;
    const n = name.toLowerCase();
    return n.includes("bedroom") || n.includes("toilet") || n.includes("bathroom") || n.includes("wc") || n.includes("pooja");
  };

  const getEntranceArrowStyle = () => {
    if (!mainDoor) return {};
    const x_px = mainDoor.x * pxPerFt;
    const y_px = mainDoor.y * pxPerFt;
    
    let left = x_px - 22 * scale; // Center horizontally
    let top = y_px - 17 * scale;  // Center vertically
    let rotate = '0deg';

    if (mainDoor.wallSide === 'top') {
      top = y_px - 38 * scale; // North setback outside house
      rotate = '0deg'; // points DOWN into the house
    } else if (mainDoor.wallSide === 'bottom') {
      top = y_px + 10 * scale; // South setback outside house
      rotate = '180deg'; // points UP into the house
    } else if (mainDoor.wallSide === 'left') {
      left = x_px - 44 * scale; // West setback outside house
      rotate = '270deg'; // points RIGHT into the house
    } else if (mainDoor.wallSide === 'right') {
      left = x_px + 10 * scale; // East setback outside house
      rotate = '90deg'; // points LEFT into the house
    }

    return { left, top, transform: [{ rotate }] };
  };

  const renderRoads = () => {
    const road = state.roadDirection || 'North Road';
    const roadsList = [];

    const drawRoadComponent = (direction, key) => {
      let style = {};
      let isVertical = false;
      const rSize = 26 * scale;
      const rOffset = 38 * scale;
      if (direction === 'North') {
        style = { top: -rOffset, left: 0, right: 0, height: rSize };
      } else if (direction === 'South') {
        style = { bottom: -rOffset, left: 0, right: 0, height: rSize };
      } else if (direction === 'East') {
        style = { right: -rOffset, top: 0, bottom: 0, width: rSize };
        isVertical = true;
      } else if (direction === 'West') {
        style = { left: -rOffset, top: 0, bottom: 0, width: rSize };
        isVertical = true;
      }

      return (
        <View key={key} style={[styles.asphaltRoad, style, isVertical ? styles.vertAsphalt : styles.horizAsphalt]}>
          <View style={isVertical ? styles.roadLaneDividerV : styles.roadLaneDividerH} />
          <Text style={[styles.asphaltRoadText, { fontSize: 6.8 * scale }, isVertical && { transform: [{ rotate: '90deg' }] }]}>
            {direction.toUpperCase()} ROADWAY (30 FT WIDE)
          </Text>
        </View>
      );
    };

    if (road.includes("Corner E+N") || road.includes("Corner E + N")) {
      roadsList.push(drawRoadComponent('North', 'road-n'));
      roadsList.push(drawRoadComponent('East', 'road-e'));
    } else if (road.includes("Corner W+S") || road.includes("Corner W + S")) {
      roadsList.push(drawRoadComponent('South', 'road-s'));
      roadsList.push(drawRoadComponent('West', 'road-w'));
    } else {
      if (road.includes("North")) roadsList.push(drawRoadComponent('North', 'road-n'));
      else if (road.includes("South")) roadsList.push(drawRoadComponent('South', 'road-s'));
      else if (road.includes("East")) roadsList.push(drawRoadComponent('East', 'road-e'));
      else if (road.includes("West")) roadsList.push(drawRoadComponent('West', 'road-w'));
    }

    return roadsList;
  };

  const renderDoorSymbol = (door) => {
    const dW_ft = door.widthFt || (door.isBathroom ? 2.3 : door.isMain ? 3.8 : 2.8);
    const dW = dW_ft * pxPerFt;
    const dH_thick = intWallThick * pxPerFt;

    const doorLeft = door.x * pxPerFt;
    const doorTop = door.y * pxPerFt;

    if (door.isMain) {
      let frameStyle = {};
      let leafL = {}, leafR = {};
      let arcL = {}, arcR = {};
      const halfW = dW / 2;

      if (door.type === 'horizontal') {
        const topOffset = door.wallSide === 'top' ? 0 : -dH_thick;
        frameStyle = {
          left: doorLeft - halfW,
          top: doorTop + topOffset,
          width: dW,
          height: dH_thick,
          backgroundColor: '#FFFFFF', 
        };

        if (door.wallSide === 'top') {
          leafL = { position: 'absolute', left: 0, top: 0, width: 2, height: halfW, backgroundColor: '#B45309' };
          leafR = { position: 'absolute', right: 0, top: 0, width: 2, height: halfW, backgroundColor: '#B45309' };
          arcL = { position: 'absolute', left: 0, top: 0, width: halfW, height: halfW, borderBottomLeftRadius: halfW, borderLeftWidth: 1, borderBottomWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(180, 83, 9, 0.7)' };
          arcR = { position: 'absolute', right: 0, top: 0, width: halfW, height: halfW, borderBottomRightRadius: halfW, borderRightWidth: 1, borderBottomWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(180, 83, 9, 0.7)' };
        } else {
          leafL = { position: 'absolute', left: 0, bottom: 0, width: 2, height: halfW, backgroundColor: '#B45309' };
          leafR = { position: 'absolute', right: 0, bottom: 0, width: 2, height: halfW, backgroundColor: '#B45309' };
          arcL = { position: 'absolute', left: 0, bottom: 0, width: halfW, height: halfW, borderTopLeftRadius: halfW, borderLeftWidth: 1, borderTopWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(180, 83, 9, 0.7)' };
          arcR = { position: 'absolute', right: 0, bottom: 0, width: halfW, height: halfW, borderTopRightRadius: halfW, borderRightWidth: 1, borderTopWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(180, 83, 9, 0.7)' };
        }
      } else {
        const leftOffset = door.wallSide === 'left' ? 0 : -dH_thick;
        frameStyle = {
          left: doorLeft + leftOffset,
          top: doorTop - halfW,
          width: dH_thick,
          height: dW,
          backgroundColor: '#FFFFFF',
        };

        if (door.wallSide === 'left') {
          leafL = { position: 'absolute', left: 0, top: 0, width: halfW, height: 2, backgroundColor: '#B45309' };
          leafR = { position: 'absolute', left: 0, bottom: 0, width: halfW, height: 2, backgroundColor: '#B45309' };
          arcL = { position: 'absolute', left: 0, top: 0, width: halfW, height: halfW, borderTopRightRadius: halfW, borderRightWidth: 1, borderTopWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(180, 83, 9, 0.7)' };
          arcR = { position: 'absolute', left: 0, bottom: 0, width: halfW, height: halfW, borderBottomRightRadius: halfW, borderRightWidth: 1, borderBottomWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(180, 83, 9, 0.7)' };
        } else {
          leafL = { position: 'absolute', right: 0, top: 0, width: halfW, height: 2, backgroundColor: '#B45309' };
          leafR = { position: 'absolute', right: 0, bottom: 0, width: halfW, height: 2, backgroundColor: '#B45309' };
          arcL = { position: 'absolute', right: 0, top: 0, width: halfW, height: halfW, borderTopLeftRadius: halfW, borderLeftWidth: 1, borderTopWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(180, 83, 9, 0.7)' };
          arcR = { position: 'absolute', right: 0, bottom: 0, width: halfW, height: halfW, borderBottomLeftRadius: halfW, borderLeftWidth: 1, borderBottomWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(180, 83, 9, 0.7)' };
        }
      }

      return (
        <View key="main-double-door" style={[styles.doorFrameBlock, frameStyle]}>
          <View style={leafL} />
          <View style={leafR} />
          <View style={arcL} />
          <View style={arcR} />
        </View>
      );
    }

    // Single doors
    let doorStyle = {};
    let leafStyle = {};
    let arcStyle = {};

    if (door.type === 'horizontal') {
      const topOffset = door.wallSide === 'top' ? 0 : -dH_thick;
      doorStyle = {
        left: doorLeft - dW / 2,
        top: doorTop + topOffset,
        width: dW,
        height: dH_thick,
        backgroundColor: '#FFFFFF',
      };

      if (door.wallSide === 'top') {
        leafStyle = { position: 'absolute', left: 0, top: 0, width: 2, height: dW, backgroundColor: '#B45309' };
        arcStyle = { position: 'absolute', left: 0, top: 0, width: dW, height: dW, borderBottomLeftRadius: dW, borderLeftWidth: 1.2, borderBottomWidth: 1.2, borderStyle: 'dashed', borderColor: 'rgba(180, 83, 9, 0.6)' };
      } else {
        leafStyle = { position: 'absolute', left: 0, bottom: 0, width: 2, height: dW, backgroundColor: '#B45309' };
        arcStyle = { position: 'absolute', left: 0, bottom: 0, width: dW, height: dW, borderTopLeftRadius: dW, borderLeftWidth: 1.2, borderTopWidth: 1.2, borderStyle: 'dashed', borderColor: 'rgba(180, 83, 9, 0.6)' };
      }
    } else {
      const leftOffset = door.wallSide === 'left' ? 0 : -dH_thick;
      doorStyle = {
        left: doorLeft + leftOffset,
        top: doorTop - dW / 2,
        width: dH_thick,
        height: dW,
        backgroundColor: '#FFFFFF',
      };

      if (door.wallSide === 'left') {
        leafStyle = { position: 'absolute', left: 0, top: 0, width: dW, height: 2, backgroundColor: '#B45309' };
        arcStyle = { position: 'absolute', left: 0, top: 0, width: dW, height: dW, borderTopRightRadius: dW, borderRightWidth: 1.2, borderTopWidth: 1.2, borderStyle: 'dashed', borderColor: 'rgba(180, 83, 9, 0.6)' };
      } else {
        leafStyle = { position: 'absolute', right: 0, top: 0, width: dW, height: 2, backgroundColor: '#B45309' };
        arcStyle = { position: 'absolute', right: 0, top: 0, width: dW, height: dW, borderTopLeftRadius: dW, borderLeftWidth: 1.2, borderTopWidth: 1.2, borderStyle: 'dashed', borderColor: 'rgba(180, 83, 9, 0.6)' };
      }
    }

    return (
      <View key={door.id} style={[styles.doorFrameBlock, doorStyle]}>
        <View style={leafStyle} />
        <View style={arcStyle} />
      </View>
    );
  };

  const renderWindowSymbol = (win) => {
    const winW = win.widthFt * pxPerFt;
    const wThick = extWallThick * pxPerFt;

    const winLeft = win.x * pxPerFt;
    const winTop = win.y * pxPerFt;

    let winStyle = {};
    let chajjaStyle = null; 

    const chajjaExtend = 5 * scale; 
    const chajjaDepth = 1.0 * pxPerFt; 
    const winVisualThick = 6 * scale; // Centered visual block thickness

    // Centering math inside the wall boundaries
    if (win.type === 'horizontal') {
      const centeringOffset = (wThick - winVisualThick) / 2;
      const finalTop = winTop + (win.side === 'top' ? centeringOffset : -wThick + centeringOffset);

      winStyle = {
        left: winLeft - winW / 2,
        top: finalTop,
        width: winW,
        height: winVisualThick,
        borderWidth: 1.2,
        borderColor: win.isBathroom ? '#475569' : '#0284C7',
        backgroundColor: win.isBathroom ? '#64748B' : '#0EA5E9',
      };

      if (win.side === 'top') {
        chajjaStyle = {
          position: 'absolute',
          left: winLeft - winW / 2 - chajjaExtend,
          top: winTop - chajjaDepth,
          width: winW + chajjaExtend * 2,
          height: chajjaDepth,
          borderStyle: 'dashed',
          borderWidth: 1,
          borderColor: '#475569',
          borderBottomWidth: 0,
        };
      } else {
        chajjaStyle = {
          position: 'absolute',
          left: winLeft - winW / 2 - chajjaExtend,
          top: winTop + wThick,
          width: winW + chajjaExtend * 2,
          height: chajjaDepth,
          borderStyle: 'dashed',
          borderWidth: 1,
          borderColor: '#475569',
          borderTopWidth: 0,
        };
      }
    } else {
      const centeringOffset = (wThick - winVisualThick) / 2;
      const finalLeft = winLeft + (win.side === 'left' ? centeringOffset : -wThick + centeringOffset);

      winStyle = {
        left: finalLeft,
        top: winTop - winW / 2,
        width: winVisualThick,
        height: winW,
        borderWidth: 1.2,
        borderColor: win.isBathroom ? '#475569' : '#0284C7',
        backgroundColor: win.isBathroom ? '#64748B' : '#0EA5E9',
      };

      if (win.side === 'left') {
        chajjaStyle = {
          position: 'absolute',
          left: winLeft - chajjaDepth,
          top: winTop - winW / 2 - chajjaExtend,
          width: chajjaDepth,
          height: winW + chajjaExtend * 2,
          borderStyle: 'dashed',
          borderWidth: 1,
          borderColor: '#475569',
          borderRightWidth: 0,
        };
      } else {
        chajjaStyle = {
          position: 'absolute',
          left: winLeft + wThick,
          top: winTop - winW / 2 - chajjaExtend,
          width: chajjaDepth,
          height: winW + chajjaExtend * 2,
          borderStyle: 'dashed',
          borderWidth: 1,
          borderColor: '#475569',
          borderLeftWidth: 0,
        };
      }
    }

    return (
      <React.Fragment key={win.id}>
        {chajjaStyle && <View style={chajjaStyle} />}
        <View style={[styles.windowGlassBlock, winStyle]}>
          <View style={win.type === 'horizontal' ? styles.winGlassCenterH : styles.winGlassCenterV} />
          {win.isKitchen && <Text style={styles.exhaustIndicator}>EF</Text>}
          <Text style={windowLabelTagStyle(win)}>{win.isBathroom ? 'V' : 'W'}</Text>
        </View>
      </React.Fragment>
    );
  };

  const windowLabelTagStyle = (win) => {
    return {
      fontSize: Math.min(10, 5.5 * scale),
      fontWeight: '900',
      color: '#0284C7',
      position: 'absolute',
      bottom: win.side === 'bottom' ? 8 : -8,
    };
  };

  const renderCirculationPath = () => {
    if (!showCirculation || !hallBlock || !mainDoor) return null;

    const hX = hallX + hallW / 2;
    const hY = hallY + hallH / 2;

    const paths = [];

    // Path 1: Entrance outside -> Main Door -> Hall Center
    paths.push(
      <RenderCirculationLine 
        key="circ-entrance" 
        x1={mainDoor.x} y1={mainDoor.y} 
        x2={hX} y2={hY} 
        pxPerFt={pxPerFt} 
        footLeft={0} footTop={0} 
      />
    );
    // Draw dot nodes at Entrance and Hall Center
    paths.push(<RenderNodeDot key="node-md" x={mainDoor.x} y={mainDoor.y} pxPerFt={pxPerFt} footLeft={0} footTop={0} />);
    paths.push(<RenderNodeDot key="node-hc" x={hX} y={hY} pxPerFt={pxPerFt} footLeft={0} footTop={0} />);

    // Paths: Main Hall -> Room Threshold Doors
    doors.forEach((door, index) => {
      paths.push(
        <RenderCirculationLine 
          key={`circ-door-${index}`} 
          x1={hX} y1={hY} 
          x2={door.x} y2={door.y} 
          pxPerFt={pxPerFt} 
          footLeft={0} footTop={0} 
        />
      );
      paths.push(<RenderNodeDot key={`node-door-${index}`} x={door.x} y={door.y} pxPerFt={pxPerFt} footLeft={0} footTop={0} />);
    });

    return paths;
  };



  // Determine the entrance cell in the 3x3 grid
  const mainDoorDir = state.mainDoorDirection || 'North';
  let entRow = 1;
  let entCol = 1;
  if (mainDoorDir === 'North') { entRow = 0; entCol = 1; }
  else if (mainDoorDir === 'South') { entRow = 2; entCol = 1; }
  else if (mainDoorDir === 'East') { entRow = 1; entCol = 2; }
  else if (mainDoorDir === 'West') { entRow = 1; entCol = 0; }

  // ==========================================
  // 1. VASTU DYNAMIC LAYOUT GRID GENERATION
  // ==========================================
  const grid = [
    [[], [], []],
    [[], [], []],
    [[], [], []]
  ];

  // Cells reserved for the main merged Hall/Living room (Center + Entrance Cell)
  const reservedCells = [`1,1`, `${entRow},${entCol}`];

  // Sort and assign rooms based on Vastu slots & architectural zoning
  const customRooms = [...state.customRooms];
  const poojaRoom = customRooms.find(r => r.name.toLowerCase().includes("pooja"));
  const kitchenRoom = customRooms.find(r => r.name.toLowerCase().includes("kitchen"));
  const masterBed = customRooms.find(r => r.name.toLowerCase().includes("master"));
  const diningRoom = customRooms.find(r => r.name.toLowerCase().includes("dining"));

  const otherRooms = customRooms.filter(r => 
    r.id !== poojaRoom?.id && 
    r.id !== kitchenRoom?.id && 
    r.id !== masterBed?.id && 
    r.id !== diningRoom?.id
  );

  // NE (0, 2) -> Pooja
  if (poojaRoom) {
    grid[0][2].push({
      id: poojaRoom.id,
      name: poojaRoom.name,
      reqW: parseFloat(poojaRoom.width) || 10,
      reqH: parseFloat(poojaRoom.length) || 10,
    });
  }

  // SE (2, 2) -> Kitchen
  if (kitchenRoom) {
    grid[2][2].push({
      id: kitchenRoom.id,
      name: kitchenRoom.name,
      reqW: parseFloat(kitchenRoom.width) || 10,
      reqH: parseFloat(kitchenRoom.length) || 10,
    });
  }

  // SW (2, 0) -> Master Bed
  if (masterBed) {
    grid[2][0].push({
      id: masterBed.id,
      name: masterBed.name,
      reqW: parseFloat(masterBed.width) || 10,
      reqH: parseFloat(masterBed.length) || 10,
    });
  }

  // E (1, 2) -> Dining (if present, keep it next to Kitchen SE)
  if (diningRoom) {
    grid[1][2].push({
      id: diningRoom.id,
      name: diningRoom.name,
      reqW: parseFloat(diningRoom.width) || 10,
      reqH: parseFloat(diningRoom.length) || 10,
    });
    reservedCells.push(`1,2`); // Reserve East cell for Dining
  }

  // Prioritize Master Bedroom Attached Washroom assignment to guarantee it adjoins Master Bedroom (SW 2,0)
  const isBathroomType = (name) => {
    if (!name) return false;
    const n = name.toLowerCase();
    return n.includes("toilet") || n.includes("bathroom") || n.includes("wc") || n.includes("washroom") || n.includes("bath");
  };
  
  let designatedAttachedBathId = null;
  const allBathrooms = otherRooms.filter(r => isBathroomType(r.name));
  if (masterBed && allBathrooms.length >= 2) {
    const masterAttachedBath = allBathrooms.find(b => b.name.toLowerCase().includes("master") || b.name.toLowerCase().includes("attached")) || allBathrooms[1] || allBathrooms[allBathrooms.length - 1];
    if (masterAttachedBath) {
      designatedAttachedBathId = masterAttachedBath.id;
      const parsedBath = {
        id: masterAttachedBath.id,
        name: masterAttachedBath.name,
        reqW: parseFloat(masterAttachedBath.width) || 10,
        reqH: parseFloat(masterAttachedBath.length) || 10,
      };
      // Assign directly to South (2,1) or West (1,0) adjacent to Master Bed (2,0)
      if (!reservedCells.includes("2,1") && grid[2][1].length === 0) {
        grid[2][1].push(parsedBath);
      } else if (!reservedCells.includes("1,0") && grid[1][0].length === 0) {
        grid[1][0].push(parsedBath);
      } else {
        // If adjacent cells are full or reserved, place inside SW (2,0) together with Master Bedroom
        grid[2][0].push(parsedBath);
      }
    }
  }

  // Allocate other private rooms (Bedrooms, Toilets) to NW, W, S, N
  const remainingOtherRooms = otherRooms.filter(r => r.id !== designatedAttachedBathId);
  const otherPrivate = remainingOtherRooms.filter(r => isPrivateRoom(r.name));
  const otherPublic = remainingOtherRooms.filter(r => !isPrivateRoom(r.name));

  // Fallback cell allocator to prevent any room from being discarded/missing
  const assignToFewestRoomsCell = (parsed) => {
    let bestR = -1;
    let bestC = -1;
    let minRooms = Infinity;
    
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const key = `${r},${c}`;
        if (reservedCells.includes(key)) continue; // Skip Hall/entrance cells
        
        const numRooms = grid[r][c].length;
        if (numRooms < minRooms) {
          minRooms = numRooms;
          bestR = r;
          bestC = c;
        }
      }
    }
    
    if (bestR !== -1 && bestC !== -1) {
      grid[bestR][bestC].push(parsed);
      return true;
    }
    return false;
  };

  const privateSlots = [[0, 0], [1, 0], [2, 1], [0, 1]];
  otherPrivate.forEach(room => {
    const parsed = {
      id: room.id,
      name: room.name,
      reqW: parseFloat(room.width) || 10,
      reqH: parseFloat(room.length) || 10,
    };
    let placed = false;
    for (const [r, c] of privateSlots) {
      const key = `${r},${c}`;
      if (!reservedCells.includes(key) && grid[r][c].length === 0) {
        grid[r][c].push(parsed);
        placed = true;
        break;
      }
    }
    // Fallback if preferred slots are full
    if (!placed) {
      assignToFewestRoomsCell(parsed);
    }
  });

  // Allocate remaining public rooms to remaining available slots
  otherPublic.forEach(room => {
    const parsed = {
      id: room.id,
      name: room.name,
      reqW: parseFloat(room.width) || 10,
      reqH: parseFloat(room.length) || 10,
    };
    let placed = false;
    const publicSlots = [[0, 1], [1, 0], [2, 1], [0, 0]];
    for (const [r, c] of publicSlots) {
      const key = `${r},${c}`;
      if (!reservedCells.includes(key) && grid[r][c].length === 0) {
        grid[r][c].push(parsed);
        placed = true;
        break;
      }
    }
    if (!placed) {
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const key = `${r},${c}`;
          if (!reservedCells.includes(key) && grid[r][c].length === 0) {
            grid[r][c].push(parsed);
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
    }
    // Fallback if all slots are full
    if (!placed) {
      assignToFewestRoomsCell(parsed);
    }
  });

  // Calculate adaptive column widths & row heights
  const getColMaxW = (c) => {
    let max = 0;
    for (let r = 0; r < 3; r++) {
      grid[r][c].forEach(rm => { 
        const n = rm.name.toLowerCase();
        const isHall = n.includes("hall") || n.includes("living") || n.includes("drawing");
        if (!isHall && rm.reqW > max) max = rm.reqW; 
      });
    }
    return max;
  };
  const getRowMaxH = (r) => {
    let max = 0;
    for (let c = 0; c < 3; c++) {
      grid[r][c].forEach(rm => { 
        const n = rm.name.toLowerCase();
        const isHall = n.includes("hall") || n.includes("living") || n.includes("drawing");
        if (!isHall && rm.reqH > max) max = rm.reqH; 
      });
    }
    return max;
  };

  let colW = [getColMaxW(0), getColMaxW(1), getColMaxW(2)];
  let rowH = [getRowMaxH(0), getRowMaxH(1), getRowMaxH(2)];

  for (let i = 0; i < 3; i++) {
    const hasColRooms = (grid[0][i].length > 0 || grid[1][i].length > 0 || grid[2][i].length > 0);
    if (hasColRooms && colW[i] === 0) colW[i] = 8;
    const hasRowRooms = (grid[i][0].length > 0 || grid[i][1].length > 0 || grid[i][2].length > 0);
    if (hasRowRooms && rowH[i] === 0) rowH[i] = 8;
  }
  if (colW[1] === 0) colW[1] = 10;
  if (rowH[1] === 0) rowH[1] = 10;

  // Proportional Scaling: scale all 3 columns and rows to fill the footprint envelope completely (no space wastage)
  const sumW = colW[0] + colW[1] + colW[2];
  const colScale = footW / Math.max(1, sumW);
  const colW_scaled = colW.map(w => w * colScale);

  const sumH = rowH[0] + rowH[1] + rowH[2];
  const rowScale = footL / Math.max(1, sumH);
  const rowH_scaled = rowH.map(h => h * rowScale);

  const colX = [0, colW_scaled[0], colW_scaled[0] + colW_scaled[1]];
  const rowY = [0, rowH_scaled[0], rowH_scaled[0] + rowH_scaled[1]];

  let blocks = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      // Skip the cells reserved for the merged Hall
      if (r === 1 && c === 1) continue;
      if (r === entRow && c === entCol) continue;

      const cellRooms = grid[r][c];
      const cellX = colX[c];
      const cellY = rowY[r];
      const cellW = colW_scaled[c];
      const cellH = rowH_scaled[r];

      if (cellRooms.length === 0) continue;

      const corridorWidth = 3.2;

      if (cellRooms.length === 1) {
        let x = cellX;
        let y = cellY;
        let w = cellW;
        let h = cellH;

        // Apply physical corridor carving to leave open passage spaces
        if (r === 1 && c === 0) { // West room: shrink right side
          w = Math.max(4.0, cellW - corridorWidth);
        } else if (r === 1 && c === 2) { // East room: shrink left side and shift right
          w = Math.max(4.0, cellW - corridorWidth);
          x = cellX + corridorWidth;
        } else if (r === 0 && c === 1) { // North room: shrink bottom side
          h = Math.max(4.0, cellH - corridorWidth);
        } else if (r === 2 && c === 1) { // South room: shrink top side and shift down
          h = Math.max(4.0, cellH - corridorWidth);
          y = cellY + corridorWidth;
        }

        blocks.push({
          id: cellRooms[0].id,
          name: cellRooms[0].name,
          x,
          y,
          w,
          h,
          gridRow: r,
          gridCol: c
        });
      } else {
        const count = cellRooms.length;
        if (cellW > cellH) {
          const subW = cellW / count;
          cellRooms.forEach((rm, idx) => {
            let x = cellX + idx * subW;
            let y = cellY;
            let w = subW;
            let h = cellH;

            if (r === 1 && c === 0) {
              w = Math.max(2.0, subW - corridorWidth);
            } else if (r === 1 && c === 2) {
              w = Math.max(2.0, subW - corridorWidth);
              x = cellX + idx * subW + corridorWidth;
            } else if (r === 0 && c === 1) {
              h = Math.max(4.0, cellH - corridorWidth);
            } else if (r === 2 && c === 1) {
              h = Math.max(4.0, cellH - corridorWidth);
              y = cellY + corridorWidth;
            }

            blocks.push({
              id: rm.id,
              name: rm.name,
              x,
              y,
              w,
              h,
              gridRow: r,
              gridCol: c
            });
          });
        } else {
          const subH = cellH / count;
          cellRooms.forEach((rm, idx) => {
            let x = cellX;
            let y = cellY + idx * subH;
            let w = cellW;
            let h = subH;

            if (r === 1 && c === 0) {
              w = Math.max(4.0, cellW - corridorWidth);
            } else if (r === 1 && c === 2) {
              w = Math.max(4.0, cellW - corridorWidth);
              x = cellX + corridorWidth;
            } else if (r === 0 && c === 1) {
              h = Math.max(2.0, subH - corridorWidth);
            } else if (r === 2 && c === 1) {
              h = Math.max(2.0, subH - corridorWidth);
              y = cellY + idx * subH + corridorWidth;
            }

            blocks.push({
              id: rm.id,
              name: rm.name,
              x,
              y,
              w,
              h,
              gridRow: r,
              gridCol: c
            });
          });
        }
      }
    }
  }

  // Create the unified merged Hall block that spans the Center cell and the Entrance cell
  let hallX = colX[1];
  let hallY = rowY[1];
  let hallW = colW_scaled[1];
  let hallH = rowH_scaled[1];

  if (mainDoorDir === 'North') {
    hallY = rowY[0];
    hallH = rowH_scaled[0] + rowH_scaled[1];
  } else if (mainDoorDir === 'South') {
    hallH = rowH_scaled[1] + rowH_scaled[2];
  } else if (mainDoorDir === 'East') {
    hallW = colW_scaled[1] + colW_scaled[2];
  } else if (mainDoorDir === 'West') {
    hallX = colX[0];
    hallW = colW_scaled[0] + colW_scaled[1];
  }

  const hallBlockId = 'merged-hall';
  blocks.push({
    id: hallBlockId,
    name: isTe ? "హాల్ (Living Room)" : "Living Room (Hall)",
    x: hallX,
    y: hallY,
    w: hallW,
    h: hallH,
    gridRow: 1,
    gridCol: 1
  });

  // Expand remaining empty corner slots to neighboring rooms to prevent dead spaces
  const occupied = Array.from({ length: 3 }, () => Array(3).fill(false));
  blocks.forEach(b => { occupied[b.gridRow][b.gridCol] = true; });
  // Set merged Hall areas as occupied
  occupied[1][1] = true;
  occupied[entRow][entCol] = true;

  if (!occupied[0][0]) {
    const neighbor = blocks.find(b => b.gridRow === 0 && b.gridCol === 1) || blocks.find(b => b.gridRow === 1 && b.gridCol === 0);
    if (neighbor) {
      if (neighbor.gridCol === 1) { neighbor.x = colX[0]; neighbor.w += colW_scaled[0]; }
      else { neighbor.y = rowY[0]; neighbor.h += rowH_scaled[0]; }
      occupied[0][0] = true;
    }
  }
  if (!occupied[0][2]) {
    const neighbor = blocks.find(b => b.gridRow === 0 && b.gridCol === 1) || blocks.find(b => b.gridRow === 1 && b.gridCol === 2);
    if (neighbor) {
      if (neighbor.gridCol === 1) { neighbor.w += colW_scaled[2]; }
      else { neighbor.y = rowY[0]; neighbor.h += rowH_scaled[0]; }
      occupied[0][2] = true;
    }
  }
  if (!occupied[2][0]) {
    const neighbor = blocks.find(b => b.gridRow === 2 && b.gridCol === 1) || blocks.find(b => b.gridRow === 1 && b.gridCol === 0);
    if (neighbor) {
      if (neighbor.gridCol === 1) { neighbor.x = colX[0]; neighbor.w += colW_scaled[0]; }
      else { neighbor.h += rowH_scaled[2]; }
      occupied[2][0] = true;
    }
  }
  if (!occupied[2][2]) {
    const neighbor = blocks.find(b => b.gridRow === 2 && b.gridCol === 1) || blocks.find(b => b.gridRow === 1 && b.gridCol === 2);
    if (neighbor) {
      if (neighbor.gridCol === 1) { neighbor.w += colW_scaled[2]; }
      else { neighbor.h += rowH_scaled[2]; }
      occupied[2][2] = true;
    }
  }

  // ==========================================
  // 2. WALLS & ROOM INSET GENERATOR (9" & 4.5")
  // ==========================================
  const extWallThick = 0.75; // 9 inches in feet
  const intWallThick = 0.375; // 4.5 inches in feet

  const roomPlacements = blocks.map(b => {
    const isLeftExt = b.x <= 0.05;
    const isTopExt = b.y <= 0.05;
    const isRightExt = Math.abs(b.x + b.w - footW) <= 0.05;
    const isBottomExt = Math.abs(b.y + b.h - footL) <= 0.05;

    const leftWall = isLeftExt ? extWallThick : intWallThick / 2;
    const topWall = isTopExt ? extWallThick : intWallThick / 2;
    const rightWall = isRightExt ? extWallThick : intWallThick / 2;
    const bottomWall = isBottomExt ? extWallThick : intWallThick / 2;

    return {
      ...b,
      visX: b.x + leftWall,
      visY: b.y + topWall,
      visW: b.w - leftWall - rightWall,
      visH: b.h - topWall - bottomWall,
      borders: {
        left: leftWall,
        top: topWall,
        right: rightWall,
        bottom: bottomWall
      }
    };
  });

  // ==========================================
  // 3. DOOR PLACEMENT (100% ROOM INDEPENDENCY)
  // ==========================================
  const doors = [];
  const hallBlock = roomPlacements.find(b => b.id === hallBlockId);

  // Attached Toilet designated resolver (if >= 2 bathrooms, attach the designated one to Master Bedroom)
  const isBathType = (name) => {
    if (!name) return false;
    const n = name.toLowerCase();
    return n.includes("toilet") || n.includes("bathroom") || n.includes("wc") || n.includes("washroom") || n.includes("bath");
  };
  const bathrooms = roomPlacements.filter(r => isBathType(r.name));
  const masterBedRoom = roomPlacements.find(r => r.name.toLowerCase().includes("master"));
  
  let attachedBathId = null;
  if (masterBedRoom && bathrooms.length >= 2) {
    if (typeof designatedAttachedBathId !== 'undefined' && designatedAttachedBathId && bathrooms.some(b => b.id === designatedAttachedBathId)) {
      attachedBathId = designatedAttachedBathId;
    } else {
      let minDistance = Infinity;
      let closestBath = null;
      bathrooms.forEach(bath => {
        const dx = (bath.x + bath.w/2) - (masterBedRoom.x + masterBedRoom.w/2);
        const dy = (bath.y + bath.h/2) - (masterBedRoom.y + masterBedRoom.h/2);
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < minDistance) {
          minDistance = dist;
          closestBath = bath;
        }
      });
      if (closestBath) {
        attachedBathId = closestBath.id;
      }
    }
  }

  roomPlacements.forEach(b => {
    if (b.id === hallBlockId) return;

    const r = b.gridRow;
    const c = b.gridCol;
    let doorPlaced = false;

    // 1. Check if this is the designated Master attached bathroom
    if (b.id === attachedBathId && masterBedRoom) {
      // Connect directly to Master Bedroom based on relative position
      const dx = (b.x + b.w / 2) - (masterBedRoom.x + masterBedRoom.w / 2);
      const dy = (b.y + b.h / 2) - (masterBedRoom.y + masterBedRoom.h / 2);

      if (Math.abs(dx) >= Math.abs(dy)) {
        if (dx > 0) { // Toilet is to the right of Master Bed (e.g., South cell vs SW cell)
          doors.push({
            id: `door-attached-${b.id}`,
            x: b.x,
            y: b.y + b.h / 2,
            type: 'vertical',
            wallSide: 'left',
            isBathroom: true
          });
        } else { // Toilet is to the left of Master Bed
          doors.push({
            id: `door-attached-${b.id}`,
            x: b.x + b.w,
            y: b.y + b.h / 2,
            type: 'vertical',
            wallSide: 'right',
            isBathroom: true
          });
        }
      } else {
        if (dy < 0) { // Toilet is above Master Bed (e.g., West cell vs SW cell)
          doors.push({
            id: `door-attached-${b.id}`,
            x: b.x + b.w / 2,
            y: b.y + b.h,
            type: 'horizontal',
            wallSide: 'bottom',
            isBathroom: true
          });
        } else { // Toilet is below Master Bed
          doors.push({
            id: `door-attached-${b.id}`,
            x: b.x + b.w / 2,
            y: b.y,
            type: 'horizontal',
            wallSide: 'top',
            isBathroom: true
          });
        }
      }
      doorPlaced = true;
      return; // Skip normal corridor door placement
    }

    // 2. Standard independent doors opening directly to Hall / Corridor
    const isBath = isBathType(b.name);
    
    if (r === 0 && c === 0) { // NW
      doors.push({
        id: `door-${b.id}`,
        x: b.x + b.w,
        y: b.y + b.h - 1.5,
        type: 'vertical',
        wallSide: 'right',
        isBathroom: isBath
      });
    } else if (r === 0 && c === 2) { // NE
      doors.push({
        id: `door-${b.id}`,
        x: b.x,
        y: b.y + b.h - 1.5,
        type: 'vertical',
        wallSide: 'left',
        isBathroom: isBath
      });
    } else if (r === 2 && c === 0) { // SW (Master Bed)
      doors.push({
        id: `door-${b.id}`,
        x: b.x + b.w - 1.5,
        y: b.y,
        type: 'horizontal',
        wallSide: 'top',
        isBathroom: isBath
      });
    } else if (r === 2 && c === 2) { // SE (Kitchen / Study)
      doors.push({
        id: `door-${b.id}`,
        x: b.x + 1.5,
        y: b.y,
        type: 'horizontal',
        wallSide: 'top',
        isBathroom: isBath
      });
    } else if (r === 0 && c === 1) { // N
      doors.push({
        id: `door-${b.id}`,
        x: b.x + b.w / 2,
        y: b.y + b.h,
        type: 'horizontal',
        wallSide: 'bottom',
        isBathroom: isBath
      });
    } else if (r === 2 && c === 1) { // S
      doors.push({
        id: `door-${b.id}`,
        x: b.x + b.w / 2,
        y: b.y,
        type: 'horizontal',
        wallSide: 'top',
        isBathroom: isBath
      });
    } else if (r === 1 && c === 0) { // W
      doors.push({
        id: `door-${b.id}`,
        x: b.x + b.w,
        y: b.y + b.h / 2,
        type: 'vertical',
        wallSide: 'right',
        isBathroom: isBath
      });
    } else if (r === 1 && c === 2) { // E
      doors.push({
        id: `door-${b.id}`,
        x: b.x,
        y: b.y + b.h / 2,
        type: 'vertical',
        wallSide: 'left',
        isBathroom: isBath
      });
    }
  });

  // Calculate Main Entrance door position on the Hall outer boundary
  let mainDoor = null;
  if (hallBlock) {
    let mdX = hallX + hallW / 2;
    let mdY = hallY;
    let mdType = 'horizontal';
    let mdSide = 'top';

    if (mainDoorDir === 'North') {
      mdX = hallX + hallW / 2;
      mdY = hallY;
    } else if (mainDoorDir === 'South') {
      mdX = hallX + hallW / 2;
      mdY = hallY + hallH;
      mdSide = 'bottom';
    } else if (mainDoorDir === 'East') {
      mdX = hallX + hallW;
      mdY = hallY + hallH / 2;
      mdType = 'vertical';
      mdSide = 'right';
    } else if (mainDoorDir === 'West') {
      mdX = hallX;
      mdY = hallY + hallH / 2;
      mdType = 'vertical';
      mdSide = 'left';
    }

    mainDoor = {
      x: mdX,
      y: mdY,
      type: mdType,
      wallSide: mdSide,
      isMain: true
    };
  }



  // ==========================================
  // 4. WINDOW & EXHAUST GENERATOR (Proportional Sizes)
  // ==========================================
  const windows = [];
  roomPlacements.forEach(b => {
    const isBath = b.name.toLowerCase().includes("toilet") || b.name.toLowerCase().includes("bathroom");
    const isKit = b.name.toLowerCase().includes("kitchen");
    let winCount = 0;

    let wSize = 4.0; 
    if (isBath) wSize = 2.0; 
    else if (b.id === hallBlockId) wSize = 5.5; 
    else if (b.name.toLowerCase().includes("master") || b.name.toLowerCase().includes("bedroom")) wSize = 4.8;
    else if (isKit) wSize = 3.6;

    // Check North Wall Exterior
    if (b.y <= 0.05 && northO > 0) {
      windows.push({
        id: `win-n-${b.id}`,
        x: b.x + b.w / 2,
        y: 0,
        widthFt: wSize,
        type: 'horizontal',
        side: 'top',
        isBathroom: isBath,
        isKitchen: isKit
      });
      winCount++;
    }
    // Check South Wall Exterior
    if (Math.abs(b.y + b.h - footL) <= 0.05 && southO > 0 && winCount < 2) {
      windows.push({
        id: `win-s-${b.id}`,
        x: b.x + b.w / 2,
        y: footL,
        widthFt: wSize,
        type: 'horizontal',
        side: 'bottom',
        isBathroom: isBath,
        isKitchen: isKit
      });
      winCount++;
    }
    // Check West Wall Exterior
    if (b.x <= 0.05 && westO > 0 && winCount < 2) {
      windows.push({
        id: `win-w-${b.id}`,
        x: 0,
        y: b.y + b.h / 2,
        widthFt: wSize,
        type: 'vertical',
        side: 'left',
        isBathroom: isBath,
        isKitchen: isKit
      });
      winCount++;
    }
    // Check East Wall Exterior
    if (Math.abs(b.x + b.w - footW) <= 0.05 && eastO > 0 && winCount < 2) {
      windows.push({
        id: `win-e-${b.id}`,
        x: footW,
        y: b.y + b.h / 2,
        widthFt: wSize,
        type: 'vertical',
        side: 'right',
        isBathroom: isBath,
        isKitchen: isKit
      });
      winCount++;
    }
  });

  // ========================================================
  // 5. UNIFIED CAD WALL DEDUPLICATION & MERGE SEGMENTS
  // ========================================================
  const rawSegments = [];

  // Thick Outer Perimeter Walls (guarantees a solid continuous outer envelope)
  rawSegments.push({
    type: 'horizontal',
    coord: extWallThick / 2,
    start: extWallThick / 2,
    end: footW - extWallThick / 2,
    thickness: extWallThick,
  });
  rawSegments.push({
    type: 'horizontal',
    coord: footL - extWallThick / 2,
    start: extWallThick / 2,
    end: footW - extWallThick / 2,
    thickness: extWallThick,
  });
  rawSegments.push({
    type: 'vertical',
    coord: extWallThick / 2,
    start: extWallThick / 2,
    end: footL - extWallThick / 2,
    thickness: extWallThick,
  });
  rawSegments.push({
    type: 'vertical',
    coord: footW - extWallThick / 2,
    start: extWallThick / 2,
    end: footL - extWallThick / 2,
    thickness: extWallThick,
  });

  roomPlacements.forEach(b => {
    if (b.id === hallBlockId) return; // Exclude Living Room (Hall) to merge corridors seamlessly with no lines
    // Left Wall
    rawSegments.push({
      type: 'vertical',
      coord: b.visX - b.borders.left / 2,
      start: b.visY - b.borders.top / 2,
      end: b.visY + b.visH + b.borders.bottom / 2,
      thickness: b.borders.left,
    });
    // Right Wall
    rawSegments.push({
      type: 'vertical',
      coord: b.visX + b.visW + b.borders.right / 2,
      start: b.visY - b.borders.top / 2,
      end: b.visY + b.visH + b.borders.bottom / 2,
      thickness: b.borders.right,
    });
    // Top Wall
    rawSegments.push({
      type: 'horizontal',
      coord: b.visY - b.borders.top / 2,
      start: b.visX - b.borders.left / 2,
      end: b.visX + b.visW + b.borders.right / 2,
      thickness: b.borders.top,
    });
    // Bottom Wall
    rawSegments.push({
      type: 'horizontal',
      coord: b.visY + b.visH + b.borders.bottom / 2,
      start: b.visX - b.borders.left / 2,
      end: b.visX + b.visW + b.borders.right / 2,
      thickness: b.borders.bottom,
    });
  });

  // Deduplicate and combine duplicate/overlapping interior wall lines
  let segments = [];
  rawSegments.forEach(newSeg => {
    let merged = false;
    for (let i = 0; i < segments.length; i++) {
      let exist = segments[i];
      if (exist.type === newSeg.type && Math.abs(exist.coord - newSeg.coord) < 0.15) {
        // Overlapping segments on the same line: merge start and end points
        const overlap = Math.max(exist.start, newSeg.start) <= Math.min(exist.end, newSeg.end) + 0.1;
        if (overlap) {
          exist.start = Math.min(exist.start, newSeg.start);
          exist.end = Math.max(exist.end, newSeg.end);
          exist.thickness = Math.max(exist.thickness, newSeg.thickness);
          merged = true;
          break;
        }
      }
    }
    if (!merged) {
      segments.push({ ...newSeg });
    }
  });

  // Split wall segments at doors and windows to create realistic gaps
  const splitSegmentsForOpenings = (openings) => {
    let current = [];
    segments.forEach(seg => {
      let intersected = [];
      openings.forEach(op => {
        const opW = op.widthFt || (op.isBathroom ? 2.3 : op.isMain ? 3.8 : 2.8);
        const opCoord = seg.type === 'horizontal' ? op.y : op.x;
        const opCenter = seg.type === 'horizontal' ? op.x : op.y;
        
        const isAligned = Math.abs(seg.coord - opCoord) < 0.25;
        if (isAligned) {
          const startOp = opCenter - opW / 2;
          const endOp = opCenter + opW / 2;
          if (startOp < seg.end && endOp > seg.start) {
            intersected.push({ start: startOp, end: endOp });
          }
        }
      });

      if (intersected.length === 0) {
        current.push(seg);
      } else {
        intersected.sort((a, b) => a.start - b.start);
        let prev = seg.start;
        intersected.forEach(inter => {
          if (inter.start > prev + 0.1) {
            current.push({ ...seg, start: prev, end: inter.start });
          }
          prev = Math.max(prev, inter.end);
        });
        if (seg.end > prev + 0.1) {
          current.push({ ...seg, start: prev, end: seg.end });
        }
      }
    });
    segments = current;
  };

  // Split walls at interior door locations
  splitSegmentsForOpenings(doors.map(d => ({ ...d, x: d.x, y: d.y })));
  // Split walls at main entrance door location
  if (mainDoor) {
    splitSegmentsForOpenings([mainDoor]);
  }
  // Split walls at exterior window locations
  splitSegmentsForOpenings(windows.map(w => ({ ...w, x: w.x, y: w.y, widthFt: w.widthFt })));

  // ==========================================
  // 6. UTILITY PLACEMENT IN SETBACKS
  // ==========================================
  const renderWallSegment = (seg, index) => {
    const s_px = seg.start * pxPerFt;
    const e_px = seg.end * pxPerFt;
    const len = e_px - s_px;
    const thick = seg.thickness * pxPerFt;
    const coord_px = seg.coord * pxPerFt;

    if (len <= 0.1 * pxPerFt) return null;

    let style = {};
    if (seg.type === 'horizontal') {
      style = {
        position: 'absolute',
        left: s_px,
        top: coord_px - thick / 2,
        width: len,
        height: thick,
        backgroundColor: '#0F172A', // Deep architectural wall fill (similar to dark blue/charcoal CAD prints)
      };
    } else {
      style = {
        position: 'absolute',
        left: coord_px - thick / 2,
        top: s_px,
        width: thick,
        height: len,
        backgroundColor: '#0F172A',
      };
    }

    return <View key={`wall-${index}`} style={style} />;
  };

  // ==========================================
  // 7. RENDER COMPONENT BLUEPRINTS
  // ==========================================
  const renderHorizontalRuler = () => {
    const ticks = [];
    const step = currentPlotWidth / 5;
    for (let i = 0; i <= 5; i++) {
      const val = Math.round((siteW / 5) * i);
      ticks.push(
        <View key={i} style={[styles.rulerTickH, { left: (step * i) }]}>
          <View style={styles.tickLineH} />
          <Text style={styles.rulerText}>{val}'</Text>
        </View>
      );
    }
    return <View style={styles.horizontalRuler}>{ticks}</View>;
  };

  const renderVerticalRuler = () => {
    const ticks = [];
    const step = currentPlotHeight / 5;
    for (let i = 0; i <= 5; i++) {
      const val = Math.round((siteL / 5) * i);
      ticks.push(
        <View key={i} style={[styles.rulerTickV, { top: (step * i) }]}>
          <View style={styles.tickLineV} />
          <Text style={styles.rulerText}>{val}'</Text>
        </View>
      );
    }
    return <View style={styles.verticalRuler}>{ticks}</View>;
  };
  const getUtilityCoordsOffset = (location, utilityType) => {
    return getUtilityCoords(location, utilityType);
  };

  const getCleanLabelText = (name, rW, rH) => {
    return getCleanRoomLabel(name, rW, rH);
  };

  return (
    <View style={styles.container}>
      
      {/* Horizontally scrollable toolbar to prevent overflow on mobile screens */}
      <View style={styles.draftToolbar}>
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false} 
          contentContainerStyle={styles.toolbarScrollContent}
        >
          <View style={styles.toolbarTitleBlock}>
            <View style={styles.onlineDot} />
            <Text style={styles.toolbarTitle}>
              {isTe ? "వాస్తు CAD నివాస ప్లాన్" : "CAD Architectural Planner Workspace"}
            </Text>
          </View>
          
          <View style={styles.toolbarDivider} />

          <View style={styles.toolbarActions}>
            <TouchableOpacity 
              style={[styles.toolBtn, showGrid && styles.activeToolBtn]} 
              onPress={() => setShowGrid(!showGrid)}
            >
              <Ionicons name="grid-outline" size={12} color={showGrid ? "#FFFFFF" : "#475569"} />
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.toolBtn, showLabels && styles.activeToolBtn]} 
              onPress={() => setShowLabels(!showLabels)}
            >
              <Ionicons name="text-outline" size={12} color={showLabels ? "#FFFFFF" : "#475569"} />
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.toolBtn, showFurniture && styles.activeToolBtn]} 
              onPress={() => setShowFurniture(!showFurniture)}
            >
              <Ionicons name="bed-outline" size={12} color={showFurniture ? "#FFFFFF" : "#475569"} />
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.toolBtn, showCirculation && styles.activeToolBtn]} 
              onPress={() => setShowCirculation(!showCirculation)}
            >
              <Ionicons name="walk-outline" size={12} color={showCirculation ? "#FFFFFF" : "#475569"} />
            </TouchableOpacity>

            <View style={styles.toolbarDivider} />

            <TouchableOpacity style={styles.toolBtn} onPress={() => setScale(Math.max(0.6, scale - 0.1))}>
              <Ionicons name="remove-outline" size={12} color="#475569" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.toolBtn} onPress={() => setScale(Math.min(1.6, scale + 0.1))}>
              <Ionicons name="add-outline" size={12} color="#475569" />
            </TouchableOpacity>

            <View style={styles.toolbarDivider} />

            <TouchableOpacity 
              style={styles.editLayoutBtn} 
              onPress={() => onOpenEditor && onOpenEditor()}
              activeOpacity={0.8}
            >
              <Ionicons name="create-outline" size={13} color="#FFFFFF" style={{ marginRight: 5 }} />
              <Text style={styles.editLayoutBtnText}>
                {isTe ? "లేఅవుట్ ఎడిట్ చేయండి" : "Edit Layout"}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>

      {/* Screen-filling drawing canvas (wrapped in horizontal/vertical ScrollView for zoom & scroll support) */}
      <View style={[styles.canvasContainer, Platform.OS === 'web' ? { flex: 1 } : { height: CANVAS_HEIGHT }]}>
        <ScrollView style={styles.scrollV} contentContainerStyle={styles.scrollContentV}>
          <ScrollView horizontal style={styles.scrollH} contentContainerStyle={styles.scrollContentH}>
            
            <View style={[styles.draftSheet, { width: currentPlotWidth + 80, height: CANVAS_HEIGHT - 60 }]}>
              <View style={[
                styles.rotateWrapper,
                { transform: [{ rotate: `${angle}deg` }] } // Removed visual scale transform to allow physical layout zooming
              ]}>
                
                {/* Centered Plot Boundary (Amber dotted outline) - centered perfectly */}
                <View style={[styles.plotBoundary, { width: currentPlotWidth, height: currentPlotHeight }]}>
                  
                  {renderHorizontalRuler()}
                  {renderVerticalRuler()}

                  {showGrid && (
                    <View style={styles.cadGridBackdrop}>
                      {Array.from({ length: 9 }).map((_, i) => (
                        <View key={`grid-v-${i}`} style={[styles.cadGridV, { left: `${(i + 1) * 10}%` }]} />
                      ))}
                      {Array.from({ length: 9 }).map((_, i) => (
                        <View key={`grid-h-${i}`} style={[styles.cadGridH, { top: `${(i + 1) * 10}%` }]} />
                      ))}
                    </View>
                  )}

                  {/* Vastu Quadrant Compass Badges (NE, NW, SE, SW) in Plot corners */}
                  <View style={[styles.quadrantBadge, { top: 6, right: 6 }]}><Text style={styles.quadrantText}>NE</Text></View>
                  <View style={[styles.quadrantBadge, { top: 6, left: 6 }]}><Text style={styles.quadrantText}>NW</Text></View>
                  <View style={[styles.quadrantBadge, { bottom: 6, right: 6 }]}><Text style={styles.quadrantText}>SE</Text></View>
                  <View style={[styles.quadrantBadge, { bottom: 6, left: 6 }]}><Text style={styles.quadrantText}>SW</Text></View>

                  {/* Setback Utilities */}
                  <View style={[styles.stairsBlueprintBlock, getUtilityCoordsOffset(state.stairsLocation, 'stairs')]}>
                    <View style={styles.stairStepRow} />
                    <View style={styles.stairStepRow} />
                    <View style={styles.stairStepRow} />
                    <View style={styles.stairStepRow} />
                    <Text style={styles.utilityTextTag}>{isTe ? "మెట్లు" : "STAIRS"}</Text>
                  </View>

                  <View style={[styles.sumpBlueprintBlock, getUtilityCoordsOffset(state.sumpLocation, 'sump')]}>
                    <Ionicons name="water-outline" size={12} color="#0284C7" />
                    <Text style={styles.utilityTextTag}>{isTe ? "సంప్" : "SUMP"}</Text>
                  </View>

                  <View style={[styles.boreholeBlueprintBlock, getUtilityCoordsOffset(state.boreLocation, 'bore')]}>
                    <View style={styles.boreRingOuter}><View style={styles.boreRingInner} /></View>
                    <Text style={styles.utilityTextTag}>{isTe ? "బోరు" : "BORE"}</Text>
                  </View>

                  <View style={[styles.septicBlueprintBlock, getUtilityCoordsOffset(state.septicLocation, 'septic')]}>
                    <Ionicons name="construct-outline" size={10} color="#64748B" />
                    <Text style={styles.utilityTextTag}>{isTe ? "సెప్టిక్" : "SEPTIC"}</Text>
                  </View>

                  <View style={[styles.outsideWcBlock, getUtilityCoordsOffset(state.outsideBtLocation, 'wc')]}>
                    <Ionicons name="water-outline" size={10} color="#64748B" />
                    <Text style={styles.utilityTextTag}>OUT WC</Text>
                  </View>

                  {/* Setback Dimension lines */}
                  {westO > 0 && (
                    <View style={[styles.dimLineRow, { left: 0, width: westOpenPx, top: currentPlotHeight / 2 - 8 }]}>
                      <Text style={styles.dimArrowText}>◀</Text>
                      <View style={styles.dimDashedLine} />
                      <Text style={styles.dimValueText}>{westO}'</Text>
                      <View style={styles.dimDashedLine} />
                      <Text style={styles.dimArrowText}>▶</Text>
                    </View>
                  )}

                  {eastO > 0 && (
                    <View style={[styles.dimLineRow, { left: westOpenPx + footWidthPx, width: eastOpenPx, top: currentPlotHeight / 2 - 8 }]}>
                      <Text style={styles.dimArrowText}>◀</Text>
                      <View style={styles.dimDashedLine} />
                      <Text style={styles.dimValueText}>{eastO}'</Text>
                      <View style={styles.dimDashedLine} />
                      <Text style={styles.dimArrowText}>▶</Text>
                    </View>
                  )}

                  {northO > 0 && (
                    <View style={[styles.dimLineCol, { top: 0, height: northOpenPx, left: currentPlotWidth / 2 - 8 }]}>
                      <Text style={styles.dimArrowTextCol}>▲</Text>
                      <View style={styles.dimDashedLineCol} />
                      <Text style={styles.dimValueTextCol}>{northO}'</Text>
                      <View style={styles.dimDashedLineCol} />
                      <Text style={styles.dimArrowTextCol}>▼</Text>
                    </View>
                  )}

                  {southO > 0 && (
                    <View style={[styles.dimLineCol, { top: northOpenPx + footHeightPx, height: southOpenPx, left: currentPlotWidth / 2 - 8 }]}>
                      <Text style={styles.dimArrowTextCol}>▲</Text>
                      <View style={styles.dimDashedLineCol} />
                      <Text style={styles.dimValueTextCol}>{southO}'</Text>
                      <View style={styles.dimDashedLineCol} />
                      <Text style={styles.dimArrowTextCol}>▼</Text>
                    </View>
                  )}

                  {/* ==========================================================
                      BUILDING CONTAINER (Unified Floor - No clumsy box outlines)
                      ========================================================== */}
                  <View style={[
                    styles.buildingFootprintWalls, 
                    { 
                      width: footWidthPx, 
                      height: footHeightPx,
                      left: westOpenPx,
                      top: northOpenPx,
                      backgroundColor: '#FFFFFF', // Unified clean white building envelope floor slab
                      borderWidth: 0, 
                    }
                  ]}>
                    
                    {/* Render borderless room overlay tiles containing labels & furniture */}
                    {roomPlacements.map((room) => {
                      const rX = room.visX * pxPerFt;
                      const rY = room.visY * pxPerFt;
                      const rW = room.visW * pxPerFt;
                      const rH = room.visH * pxPerFt;

                      const cleanLabelName = getCleanLabelText(room.name, rW, rH);
                      const isSmall = rW < 52 || rH < 52;

                      return (
                        <View 
                          key={room.id}
                          style={[
                            styles.draftRoomBox,
                            {
                              left: rX,
                              top: rY,
                              width: rW,
                              height: rH,
                              backgroundColor: '#FFFFFF', // Seamless uniform white interior floor
                              borderWidth: 0, // NO double bordered boxes!
                            }
                          ]}
                        >
                          {renderRoomFurniture(room)}

                          {showLabels && (
                            <View style={styles.roomTextCentering}>
                              {!isSmall && (
                                <Ionicons name={getRoomIcon(room.name)} size={12} color="#475569" style={{ marginBottom: 2 }} />
                              )}
                              <Text style={[styles.roomLabelText, isSmall && { fontSize: 6.8 }]} numberOfLines={1}>
                                {cleanLabelName}
                              </Text>
                              <Text style={[styles.roomSizeText, isSmall && { fontSize: 5.5 }]}>
                                {Math.round(room.visW)}'×{Math.round(room.visH)}'
                              </Text>
                            </View>
                          )}
                        </View>
                      );
                    })}

                    {/* Main Gate & Entrance Arrow (Visually outside, pointing directly at door) */}
                    {mainDoor && (
                      <View style={[styles.entranceArrowContainer, getEntranceArrowStyle()]}>
                        <Ionicons name="arrow-down-circle" size={20 * scale} color="#10B981" />
                        <Text style={styles.entranceLabelTag}>MAIN GATE</Text>
                      </View>
                    )}

                    {/* Unified Bold CAD Wall Segments drawn over the rooms, leaving clean door/window gaps */}
                    {segments.map((seg, idx) => renderWallSegment(seg, idx))}

                    {/* Door Leaf & swing Arc symbols rendered cleanly inside the gaps */}
                    {doors.map(d => renderDoorSymbol(d))}
                    {mainDoor && renderDoorSymbol(mainDoor)}

                    {/* Window Glass dividers and Sunshade lines rendered inside the gaps */}
                    {windows.map(w => renderWindowSymbol(w))}



                    {/* Optional circulation paths */}
                    {renderCirculationPath()}

                  </View>

                  {renderRoads()}
                </View>

              </View>

              {/* Compass symbol */}
              <View style={[styles.goldCompass, { transform: [{ rotate: `${angle}deg` }] }]}>
                <Ionicons name="compass" size={26} color={theme.colors.accent} />
                <Text style={styles.compassLabel}>N</Text>
              </View>

            </View>

          </ScrollView>
        </ScrollView>

        {/* Legend Overlay Section (Senior Architectural Design UI) */}
        <View style={styles.legendContainer}>
          <View style={legendHeaderStyle(scale)}>
            <Text style={styles.legendTitle}>{isTe ? "సూచిక" : "ARCHITECTURAL BLUEPRINT LEGEND"}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.legendContent}>
            <View style={styles.legendItem}>
              <View style={[styles.legendBox, { backgroundColor: '#0F172A', borderWidth: 0 }]} />
              <Text style={styles.legendText}>{isTe ? "నివాస కాంక్రీట్ గోడ" : "CAD Solid Wall"}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendBox, { backgroundColor: '#0EA5E9', borderColor: '#0284C7' }]} />
              <Text style={styles.legendText}>{isTe ? "కిటికీ / సన్ షేడ్" : "Window / Sunshade (Chajja)"}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendBox, { backgroundColor: '#64748B', borderColor: '#475569' }]} />
              <Text style={styles.legendText}>{isTe ? "Frosted వెంటిలేటర్" : "Frosted Ventilator (V)"}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendBox, { backgroundColor: 'transparent', borderColor: '#B45309', borderStyle: 'dashed' }]} />
              <Text style={styles.legendText}>{isTe ? "డోర్ స్వింగ్ ఆర్క్" : "Door Swing Arc"}</Text>
            </View>
          </ScrollView>
        </View>

        {/* Footer specifications */}
        <Text style={styles.statusFooter}>
          {isTe 
            ? `స్థలం: ${state.siteWidth}×${state.siteLength} అడుగులు | బిల్డప్ ఏరియా: ${Math.round(footW * footL)} చ.అ` 
            : `Plot: ${state.siteWidth}×${state.siteLength} ft | Built Area: ${Math.round(footW * footL)} sq.ft`}
        </Text>
      </View>

    </View>
  );
}

const legendHeaderStyle = (scale) => {
  return {
    marginBottom: 4,
    alignItems: 'center',
    display: scale > 1.2 ? 'none' : 'flex', // hides legend header to conserve vertical space under high zoom factors
  };
};

// Circulation line helper
const RenderCirculationLine = ({ x1, y1, x2, y2, pxPerFt, footLeft, footTop }) => {
  const x1_px = footLeft + x1 * pxPerFt;
  const y1_px = footTop + y1 * pxPerFt;
  const x2_px = footLeft + x2 * pxPerFt;
  const y2_px = footTop + y2 * pxPerFt;

  const dx = x2_px - x1_px;
  const dy = y2_px - y1_px;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;

  return (
    <View style={{
      position: 'absolute',
      left: (x1_px + x2_px) / 2 - length / 2,
      top: (y1_px + y2_px) / 2 - 1,
      width: length,
      height: 2,
      borderTopWidth: 1.8,
      borderTopColor: '#10B981',
      borderStyle: 'dashed',
      transform: [{ rotate: `${angle}deg` }],
      opacity: 0.8,
      zIndex: 25 // Elevated overlay for circulation path
    }} />
  );
};

const RenderNodeDot = ({ x, y, pxPerFt, footLeft, footTop }) => {
  const x_px = footLeft + x * pxPerFt;
  const y_px = footTop + y * pxPerFt;
  return (
    <View style={{
      position: 'absolute',
      left: x_px - 4,
      top: y_px - 4,
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: '#10B981',
      borderWidth: 1.5,
      borderColor: '#FFFFFF',
      zIndex: 26,
    }} />
  );
};

const getStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC', // Premium light mode architectural paper background
  },
  draftToolbar: {
    borderBottomWidth: 1.2,
    borderBottomColor: '#CBD5E1',
    height: 48,
    backgroundColor: '#F1F5F9',
    width: '100%',
  },
  toolbarScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: '100%',
    gap: 8,
  },
  toolbarTitleBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  toolbarTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1E293B',
    letterSpacing: 0.5,
  },
  toolbarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  toolBtn: {
    width: 26,
    height: 26,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  activeToolBtn: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  toolbarDivider: {
    width: 1,
    height: 18,
    backgroundColor: '#CBD5E1',
    marginHorizontal: 4,
  },
  editLayoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2563EB',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
    marginLeft: 4,
  },
  editLayoutBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  canvasContainer: {
    backgroundColor: '#F8FAFC', 
    position: 'relative',
    overflow: 'hidden',
    width: '100%',
  },
  scrollV: {
    flex: 1,
    width: '100%',
  },
  scrollContentV: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  scrollH: {
    flexDirection: 'row',
    width: '100%',
  },
  scrollContentH: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  horizontalRuler: {
    position: 'absolute',
    top: -20,
    left: 0,
    right: 0,
    height: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#CBD5E1',
  },
  rulerTickH: {
    position: 'absolute',
    top: 0,
    alignItems: 'center',
    height: '100%',
    width: 24,
  },
  tickLineH: {
    width: 1.2,
    height: 6,
    backgroundColor: '#94A3B8',
  },
  rulerText: {
    fontSize: 7,
    fontWeight: '700',
    color: '#64748B',
    marginTop: 2,
  },
  verticalRuler: {
    position: 'absolute',
    top: 0,
    left: -20,
    bottom: 0,
    width: 20,
    borderRightWidth: 1,
    borderRightColor: '#CBD5E1',
  },
  rulerTickV: {
    position: 'absolute',
    left: 0,
    alignItems: 'center',
    flexDirection: 'row',
    height: 12,
    width: '100%',
  },
  tickLineV: {
    height: 1.2,
    width: 6,
    backgroundColor: '#94A3B8',
  },
  draftSheet: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  rotateWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  plotBoundary: {
    borderWidth: 2,
    borderColor: '#D97706',
    borderStyle: 'dashed',
    backgroundColor: '#FFFFFF', // White interior plot drawing
  },
  cadGridBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  cadGridV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 0.5,
    backgroundColor: 'rgba(148, 163, 184, 0.15)', // Soft blue-grey grid lines
  },
  cadGridH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 0.5,
    backgroundColor: 'rgba(148, 163, 184, 0.15)',
  },
  quadrantBadge: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FEF3C7',
    borderWidth: 0.8,
    borderColor: '#D97706',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  quadrantText: {
    fontSize: 6,
    fontWeight: '900',
    color: '#D97706',
  },
  asphaltRoad: {
    position: 'absolute',
    backgroundColor: '#E2E8F0', // Soft concrete road background
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5,
    borderColor: '#CBD5E1',
    borderWidth: 1,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  horizAsphalt: {
    left: 0,
    right: 0,
  },
  vertAsphalt: {
    top: 0,
    bottom: 0,
  },
  roadLaneDividerH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    borderWidth: 0.8,
    borderColor: '#FFFFFF', 
    borderStyle: 'dashed',
  },
  roadLaneDividerV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    borderWidth: 0.8,
    borderColor: '#FFFFFF',
    borderStyle: 'dashed',
  },
  asphaltRoadText: {
    fontWeight: '900',
    color: '#475569',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 2,
    letterSpacing: 0.8,
  },
  buildingFootprintWalls: {
    position: 'absolute',
    overflow: 'visible',
  },
  draftRoomBox: {
    position: 'absolute',
    overflow: 'hidden',
  },
  roomTextCentering: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 12,
  },
  roomLabelText: {
    fontSize: 7.5,
    fontWeight: '800',
    color: '#1E293B',
    textAlign: 'center',
  },
  roomSizeText: {
    fontSize: 6,
    color: '#475569',
    marginTop: 1,
    fontWeight: '600',
  },
  goldCompass: {
    position: 'absolute',
    top: 12,
    right: 12,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: theme.colors.accent, 
    borderRadius: 20,
    padding: 2,
    width: 38,
    height: 38,
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  compassLabel: {
    fontSize: 7,
    fontWeight: '900',
    color: theme.colors.accent,
    marginTop: -4,
  },
  statusFooter: {
    fontSize: 9.5,
    color: '#475569',
    height: 28,
    lineHeight: 28,
    backgroundColor: '#E2E8F0',
    textAlign: 'center',
    fontWeight: '700',
    borderTopWidth: 1,
    borderTopColor: '#CBD5E1',
  },
  dimLineRow: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 16,
    zIndex: 15,
  },
  dimDashedLine: {
    flex: 1,
    height: 0.8,
    borderWidth: 0.5,
    borderColor: '#D97706',
    borderStyle: 'dashed',
  },
  dimArrowText: {
    fontSize: 7,
    color: '#D97706',
    lineHeight: 8,
  },
  dimValueText: {
    fontSize: 8,
    fontWeight: '800',
    color: '#D97706',
    paddingHorizontal: 3,
    backgroundColor: '#FFFFFF',
  },
  dimLineCol: {
    position: 'absolute',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: 16,
    zIndex: 15,
  },
  dimDashedLineCol: {
    flex: 1,
    width: 0.8,
    borderWidth: 0.5,
    borderColor: '#D97706',
    borderStyle: 'dashed',
  },
  dimArrowTextCol: {
    fontSize: 7,
    color: '#D97706',
    lineHeight: 8,
  },
  dimValueTextCol: {
    fontSize: 8,
    fontWeight: '800',
    color: '#D97706',
    paddingVertical: 2,
    backgroundColor: '#FFFFFF',
    textAlign: 'center',
  },
  stairsBlueprintBlock: {
    position: 'absolute',
    borderWidth: 1.2,
    borderColor: '#94A3B8',
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 12,
  },
  stairStepRow: {
    width: '100%',
    height: '20%',
    borderBottomWidth: 0.8,
    borderBottomColor: '#CBD5E1',
  },
  sumpBlueprintBlock: {
    position: 'absolute',
    borderWidth: 1.2,
    borderColor: '#0284C7',
    backgroundColor: '#E0F2FE',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 2,
    zIndex: 12,
  },
  boreholeBlueprintBlock: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 12,
  },
  boreRingOuter: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.2,
    borderColor: '#0284C7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  boreRingInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#0284C7',
  },
  septicBlueprintBlock: {
    position: 'absolute',
    borderWidth: 1.2,
    borderColor: '#94A3B8',
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 2,
    zIndex: 12,
  },
  outsideWcBlock: {
    position: 'absolute',
    borderWidth: 1.2,
    borderColor: '#94A3B8',
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 12,
  },
  utilityTextTag: {
    fontSize: 5,
    fontWeight: '800',
    color: '#64748B',
    textAlign: 'center',
    marginTop: 2,
  },
  doorFrameBlock: {
    position: 'absolute',
    zIndex: 15,
    overflow: 'visible',
  },
  windowGlassBlock: {
    position: 'absolute',
    zIndex: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  winGlassCenterH: {
    width: '100%',
    height: 1,
    backgroundColor: '#0EA5E9',
  },
  winGlassCenterV: {
    height: '100%',
    width: 1,
    backgroundColor: '#0EA5E9',
  },
  entranceArrowContainer: {
    position: 'absolute',
    alignItems: 'center',
    width: 44,
    zIndex: 20,
  },
  entranceLabelTag: {
    fontSize: 5.5,
    fontWeight: '950',
    color: '#065F46',
    marginTop: 1,
    backgroundColor: '#D1FAE5',
    borderWidth: 0.8,
    borderColor: '#059669',
    borderRadius: 3,
    paddingHorizontal: 3,
    paddingVertical: 0.5,
    letterSpacing: 0.3,
  },
  furnitureOverlayContainer: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  bedFurniture: {
    position: 'absolute',
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#D97706',
    borderRadius: 2,
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: 3,
  },
  bedPillowsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  bedPillow: {
    width: '38%',
    height: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 0.8,
    borderColor: '#D97706',
    borderRadius: 1,
  },
  bedHeadboard: {
    width: '100%',
    height: 3,
    backgroundColor: '#D97706',
  },
  bedBlanket: {
    width: '100%',
    height: '40%',
    backgroundColor: '#FEF3C7',
    opacity: 0.4,
    borderTopWidth: 0.8,
    borderColor: '#D97706',
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  kitchenCounterV: {
    position: 'absolute',
    backgroundColor: '#E2E8F0',
    borderLeftWidth: 1,
    borderColor: '#CBD5E1',
  },
  kitchenCounterH: {
    position: 'absolute',
    backgroundColor: '#E2E8F0',
    borderTopWidth: 1,
    borderColor: '#CBD5E1',
  },
  cooktopStove: {
    position: 'absolute',
    width: 18,
    height: 12,
    backgroundColor: '#334155',
    borderRadius: 2,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    zIndex: 10,
  },
  burnerCircle: {
    width: 4,
    height: 4,
    borderRadius: 2,
    borderWidth: 0.8,
    borderColor: '#F97316',
    backgroundColor: '#1E293B',
  },
  kitchenSink: {
    position: 'absolute',
    width: 14,
    height: 14,
    backgroundColor: '#CBD5E1',
    borderWidth: 1,
    borderColor: '#94A3B8',
    borderRadius: 1,
  },
  toiletCommode: {
    position: 'absolute',
    left: 6,
    top: 6,
    width: 14,
    height: 20,
    alignItems: 'center',
  },
  toiletTank: {
    width: 12,
    height: 5,
    backgroundColor: '#E2E8F0',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 1,
  },
  toiletBowl: {
    width: 10,
    height: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 5,
    marginTop: 1,
  },
  washBasinCorner: {
    position: 'absolute',
    right: 4,
    top: 4,
    width: 12,
    height: 12,
    borderBottomLeftRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
  },
  sofaSectional: {
    position: 'absolute',
    left: 4,
    top: 4,
    bottom: 4,
    width: 14,
    backgroundColor: '#E2E8F0',
    borderRadius: 1,
  },
  sofaSeatLong: {
    width: '100%',
    height: '100%',
    borderRightWidth: 1,
    borderColor: '#CBD5E1',
  },
  sofaSeatShort: {
    position: 'absolute',
    left: 14,
    top: 0,
    width: 20,
    height: 14,
    backgroundColor: '#E2E8F0',
    borderBottomWidth: 1,
    borderColor: '#CBD5E1',
  },
  coffeeTable: {
    position: 'absolute',
    left: 24,
    top: 24,
    width: 18,
    height: 12,
    backgroundColor: '#FEF3C7',
    borderWidth: 1.2,
    borderColor: '#D97706',
    borderRadius: 1,
  },
  diningTableSet: {
    position: 'absolute',
    left: '20%',
    top: '25%',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 2,
  },
  diningTablePlate: {
    flex: 1,
    height: '100%',
    backgroundColor: '#FEF3C7',
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#D97706',
  },
  diningChairDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#CBD5E1',
    borderWidth: 0.8,
    borderColor: '#94A3B8',
  },
  poojaPedestal: {
    position: 'absolute',
    right: 4,
    top: 4,
    width: 16,
    height: 16,
    backgroundColor: '#FEF3C7',
    borderWidth: 1.2,
    borderColor: '#D97706',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 1,
  },
  legendContainer: {
    position: 'absolute',
    bottom: 28,
    left: 0,
    right: 0,
    backgroundColor: '#F1F5F9',
    borderTopWidth: 1.2,
    borderColor: '#CBD5E1',
    paddingVertical: 8,
    paddingHorizontal: 12,
    zIndex: 30,
  },
  legendHeader: {
    marginBottom: 4,
    alignItems: 'center',
  },
  legendTitle: {
    fontSize: 7.5,
    fontWeight: '850',
    color: '#475569',
    letterSpacing: 0.5,
  },
  legendContent: {
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendBox: {
    width: 12,
    height: 12,
    borderRadius: 2,
    borderWidth: 1,
  },
  legendLine: {
    width: 16,
    height: 0,
    borderTopWidth: 2,
  },
  legendText: {
    fontSize: 7.2,
    fontWeight: '700',
    color: '#475569',
  }
});
