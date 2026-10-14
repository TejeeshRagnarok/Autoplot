import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Dimensions, Platform } from 'react-native';
import { lightTheme as staticTheme } from '../constants/theme';
import { NAKSHATRAS, calculateTaraBalam, getPadamFromVarga, checkAyaVyayaYoni, generateBuildingSize } from '../constants/vastuData';
import { Ionicons } from '@expo/vector-icons';
import VastuFooter from './VastuFooter';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function ReportsPDF({ language, state, theme: propTheme, onOpenEditor }) {
  const isTe = language === 'te';
  const theme = propTheme || staticTheme;
  const styles = getStyles(theme);
  const [selectedPage, setSelectedPage] = useState(1);

  const officeAddress = isTe 
    ? "శ్రీ విశ్వకర్మ వాస్తు పీఠం, ప్లాట్ నం. 402, శ్రీ సాయి నగర్, హైదరాబాద్."
    : "Sri Vishwakarma Vastu Peetham, Plot No. 402, Sri Sai Nagar, Hyderabad.";
  const contactCell = "Cell: +91 98480 22338, +91 90100 10808";

  const ownerStarObj = NAKSHATRAS.find(n => n.nameEn === state.nakshatra || n.nameTe === state.nakshatra);
  const taraResult = calculateTaraBalam(ownerStarObj ? ownerStarObj.id : 1, 17);
  const padamResult = getPadamFromVarga(state.ownerName);
  const footprint = generateBuildingSize(state.siteLength, state.siteWidth, state.eastOpen, state.westOpen, state.northOpen, state.southOpen);

  const triggerPrint = () => {
    Alert.alert(isTe ? "ప్రింట్" : "Print Report", isTe ? "ప్రింటర్ సిగ్నల్ శోధించబడుతోంది..." : "Searching for architectural plotter printer...", [{ text: "OK" }]);
  };

  const triggerDownload = () => {
    Alert.alert(isTe ? "డౌన్‌లోడ్" : "Download PDF", isTe ? "వాస్తు ప్లాన్ PDF డౌన్‌లోడ్ చేయబడింది." : "Architectural Vastu Report downloaded successfully.", [{ text: "OK" }]);
  };

  const getVastuTips = () => {
    const facing = state.siteFacing;
    if (facing === "East") {
      return [
        isTe ? "తూర్పు ముఖద్వారం గల స్థలాల్లో ఈశాన్య మూలలో ప్రధాన ద్వారం నిర్మించాలి." : "For East-facing plots, place the main entrance in the Northeast quadrant.",
        isTe ? "ఆగ్నేయ దిశలో వంటగది (Kitchen) ఉండడం అత్యంత శుభకరం." : "Place the kitchen in the Southeast (Agni zone) for prosperity.",
        isTe ? "నైరుతి దిశలో యజమాని బెడ్ రూమ్ (Master Bedroom) ఎత్తుగా ఉండాలి." : "The Master Bedroom should be built in the Southwest (Nairutya) corner."
      ];
    } else if (facing === "West") {
      return [
        isTe ? "పడమర ముఖద్వారానికి వాయువ్యంలో కాకుండా పశ్చిమ భాగంలో ద్వారం పెట్టాలి." : "Main entrance should be in the West zone, avoiding extreme Northwest.",
        isTe ? "ఆగ్నేయంలో వంటగది మరియు నైరుతిలో యజమాని గది నిర్మించాలి." : "Maintain kitchen in Southeast and master bedroom in Southwest.",
        isTe ? "పడమర వైపు స్థలం తూర్పు కంటే ఎత్తుగా ఉండేలా చూసుకోవాలి." : "Ensure the West side of the plot is higher than the East side."
      ];
    } else if (facing === "South") {
      return [
        isTe ? "దక్షిణ ముఖద్వారానికి దక్షిణం మధ్య భాగంలో లేదా ఉచ్ఛ స్థానంలో ద్వారం ఉంచాలి." : "For South-facing plots, place the door in the center-south auspicious grid.",
        isTe ? "ఆగ్నేయంలో వంటగది తప్పనిసరిగా ఉండాలి." : "Kitchen in the Southeast (Fire element) is highly mandatory here.",
        isTe ? "ఈశాన్యంలో ఖాళీ స్థలం మరియు తూర్పున ఎక్కువ ద్వారాలు మంచిది." : "Leave more open space in the Northeast and North corridors."
      ];
    } else {
      return [
        isTe ? "ఉత్తర ముఖద్వారానికి ఉత్తరం లేదా ఈశాన్యం లో ప్రధాన ద్వారం అత్యుత్తమం." : "For North-facing plots, Northeast or center North main entrance is best.",
        isTe ? "వాయువ్యంలో అతిథి గది లేదా టాయిలెట్ నిర్మించవచ్చు." : "Northwest (Vayu zone) is ideal for Guest Bedroom, dining or washroom.",
        isTe ? "ఉత్తర భాగంలో ఎక్కువ ఓపెన్ సెట్-బ్యాక్ వదలడం శుభకరం." : "Ensure generous open spaces are left on the North side of the structure."
      ];
    }
  };

  const renderPage1 = () => (
    <View style={styles.pdfSheet}>
      <View style={styles.sheetInnerFrame}>
        <View style={styles.sheetHeader}>
          <Text style={styles.devotionalText}>జై గురుదేవ 🙏 జై శ్రీ విశ్వకర్మ 🙏</Text>
          <Text style={styles.sheetTitle}>వాస్తు శాస్త్ర విశ్లేషణ పత్రం</Text>
          <Text style={styles.sheetSubtitle}>VASTU SHASTRA ANALYSIS REPORT</Text>
          <View style={styles.sheetDivider} />
        </View>

        <Text style={styles.sheetSectionTitle}>{isTe ? "1. యజమాని మరియు స్థల వివరాలు" : "1. Owner & Site Coordinates"}</Text>
        
        <View style={styles.sheetTable}>
          <View style={styles.sheetTableRow}>
            <Text style={styles.sheetTableCellLabel}>{isTe ? "యజమాని పేరు" : "Client Name"}</Text>
            <Text style={styles.sheetTableCellValue}>{state.ownerName}</Text>
          </View>
          <View style={styles.sheetTableRow}>
            <Text style={styles.sheetTableCellLabel}>{isTe ? "జన్మ నక్షత్రం (రాశి)" : "Birth Star & Rashi"}</Text>
            <Text style={styles.sheetTableCellValue}>{state.nakshatra} ({state.rashi})</Text>
          </View>
          <View style={styles.sheetTableRow}>
            <Text style={styles.sheetTableCellLabel}>{isTe ? "స్థలం వైశాల్యం" : "Site Dimensions"}</Text>
            <Text style={styles.sheetTableCellValue}>{state.siteWidth} × {state.siteLength} ft</Text>
          </View>
          <View style={styles.sheetTableRow}>
            <Text style={styles.sheetTableCellLabel}>{isTe ? "ఫేసింగ్ (రోడ్డు)" : "Facing & Road"}</Text>
            <Text style={styles.sheetTableCellValue}>{state.siteFacing} ({state.roadDirection})</Text>
          </View>
        </View>

        <Text style={styles.sheetSectionTitle}>{isTe ? "2. జ్యోతిష వాస్తు గణితం" : "2. Astrological Calculations"}</Text>
        
        <View style={styles.sheetTable}>
          <View style={styles.sheetTableRow}>
            <Text style={styles.sheetTableCellLabel}>{isTe ? "తారాబల ఫలితం" : "Tara Balam Status"}</Text>
            <Text style={[styles.sheetTableCellValue, { fontWeight: '750', color: theme.colors.success }]}>
              {isTe ? taraResult.ratingTe : taraResult.rating}
            </Text>
          </View>
          <View style={styles.sheetTableRow}>
            <Text style={styles.sheetTableCellLabel}>{isTe ? "నామ వర్గం (యోని)" : "Varga Padam (Yoni)"}</Text>
            <Text style={styles.sheetTableCellValue}>{isTe ? padamResult.vargaTe : padamResult.vargaEn}</Text>
          </View>
          <View style={styles.sheetTableRow}>
            <Text style={styles.sheetTableCellLabel}>{isTe ? "నిర్మాణ విస్తీర్ణం" : "Construction Carpet Area"}</Text>
            <Text style={styles.sheetTableCellValue}>{footprint.width} × {footprint.length} ft ({footprint.area} Sq.Ft)</Text>
          </View>
        </View>

        <View style={styles.sheetFooter}>
          <View style={styles.sheetFooterLine} />
          <Text style={styles.footerAddressText}>{officeAddress}</Text>
          <Text style={styles.footerCellText}>{contactCell}</Text>
          <Text style={styles.pageNumberText}>Page 1 of 4</Text>
        </View>
      </View>
    </View>
  );

  const renderPage2 = () => (
    <View style={styles.pdfSheet}>
      <View style={styles.sheetInnerFrame}>
        <View style={styles.sheetHeader}>
          <Text style={styles.devotionalText}>జై గురుదేవ 🙏 జై శ్రీ విశ్వకర్మ 🙏</Text>
          <Text style={styles.sheetTitle}>వాస్తు శాస్త్ర విశ్లేషణ పత్రం</Text>
          <Text style={styles.sheetSubtitle}>VASTU SHASTRA ANALYSIS REPORT</Text>
          <View style={styles.sheetDivider} />
        </View>

        <Text style={styles.sheetSectionTitle}>{isTe ? "2. నిర్దేశిత లేఅవుట్ ప్లాన్" : "2. Architectural Layout Plan"}</Text>

        <View style={styles.blueprintSheetCard}>
          <View style={styles.blueprintMockFrame}>
            <View style={styles.northIndicatorBadge}>
              <Text style={styles.northText}>N</Text>
            </View>
            <Text style={styles.blueprintTitleLabel}>{isTe ? "స్థలం సరిహద్దు" : "Plot boundary"}: {state.siteWidth}×{state.siteLength} ft</Text>
            
            <View style={styles.blueprintMainBuilding}>
              <Text style={styles.blueprintMainLabel}>
                {isTe ? "నిర్మాణ విస్తీర్ణం" : "Footprint Area"}{'\n'}{footprint.width}×{footprint.length} ft
              </Text>
            </View>
          </View>
          <Text style={styles.blueprintDetailsLine}>
            {isTe ? "సింహద్వారం: " : "Entrance: "}{state.mainDoorDirection} | 
            {isTe ? " రోడ్డు: " : " Road: "}{state.roadDirection}
          </Text>
          {onOpenEditor && (
            <TouchableOpacity 
              style={styles.pdfEditBtn} 
              onPress={onOpenEditor}
              activeOpacity={0.8}
            >
              <Ionicons name="create-outline" size={13} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.pdfEditBtnText}>
                {isTe ? "లేఅవుట్ ఎడిట్ చేయండి" : "Edit Layout in CAD Studio"}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={[styles.sheetTable, { marginTop: 12 }]}>
          <View style={styles.sheetTableRow}>
            <Text style={styles.sheetTableCellLabel}>{isTe ? "తూర్పు సెట్-బ్యాక్" : "East Setback"}</Text>
            <Text style={styles.sheetTableCellValue}>{state.eastOpen} ft</Text>
          </View>
          <View style={styles.sheetTableRow}>
            <Text style={styles.sheetTableCellLabel}>{isTe ? "పడమర సెట్-బ్యాక్" : "West Setback"}</Text>
            <Text style={styles.sheetTableCellValue}>{state.westOpen} ft</Text>
          </View>
          <View style={styles.sheetTableRow}>
            <Text style={styles.sheetTableCellLabel}>{isTe ? "ఉత్తర సెట్-బ్యాక్" : "North Setback"}</Text>
            <Text style={styles.sheetTableCellValue}>{state.northOpen} ft</Text>
          </View>
          <View style={styles.sheetTableRow}>
            <Text style={styles.sheetTableCellLabel}>{isTe ? "దక్షిణ సెట్-బ్యాక్" : "South Setback"}</Text>
            <Text style={styles.sheetTableCellValue}>{state.southOpen} ft</Text>
          </View>
        </View>

        <View style={styles.sheetFooter}>
          <View style={styles.sheetFooterLine} />
          <Text style={styles.footerAddressText}>{officeAddress}</Text>
          <Text style={styles.footerCellText}>{contactCell}</Text>
          <Text style={styles.pageNumberText}>Page 2 of 4</Text>
        </View>
      </View>
    </View>
  );

  const renderPage3 = () => (
    <View style={styles.pdfSheet}>
      <View style={styles.sheetInnerFrame}>
        <View style={styles.sheetHeader}>
          <Text style={styles.devotionalText}>జై గురుదేవ 🙏 జై శ్రీ విశ్వకర్మ 🙏</Text>
          <Text style={styles.sheetTitle}>వాస్తు శాస్త్ర విశ్లేషణ పత్రం</Text>
          <Text style={styles.sheetSubtitle}>VASTU SHASTRA ANALYSIS REPORT</Text>
          <View style={styles.sheetDivider} />
        </View>

        <Text style={styles.sheetSectionTitle}>{isTe ? "3. గదుల వైశాల్య ఆయ వ్యయ పట్టిక" : "3. Room Vastu Aya & Vyaya Matrix"}</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ width: '100%' }}>
          <View style={[styles.reportMatrixTable, { minWidth: 360 }]}>
            <View style={styles.matrixHeaderRow}>
              <Text style={[styles.matrixHeaderCell, { flex: 1.8 }]}>{isTe ? "గది పేరు" : "Room"}</Text>
              <Text style={[styles.matrixHeaderCell, { flex: 1.2 }]}>{isTe ? "సైజు" : "Size"}</Text>
              <Text style={[styles.matrixHeaderCell, { flex: 0.8 }]}>{isTe ? "ఆదాయం" : "Aya"}</Text>
              <Text style={[styles.matrixHeaderCell, { flex: 0.8 }]}>{isTe ? "వ్యయం" : "Vyaya"}</Text>
              <Text style={[styles.matrixHeaderCell, { flex: 1.2 }]}>{isTe ? "యోని" : "Yoni"}</Text>
              <Text style={[styles.matrixHeaderCell, { flex: 1.2 }]}>{isTe ? "ఫలితం" : "Status"}</Text>
            </View>

            {state.customRooms.map((room, idx) => {
              const roomRes = checkAyaVyayaYoni(room.width, room.length);
              return (
                <View key={room.id} style={[styles.matrixDataRow, { backgroundColor: idx % 2 === 0 ? '#FAFBFD' : '#FFFFFF' }]}>
                  <Text style={[styles.matrixDataCell, { flex: 1.8, fontWeight: '700' }]}>{room.name}</Text>
                  <Text style={[styles.matrixDataCell, { flex: 1.2 }]}>{room.width}×{room.length} ft</Text>
                  <Text style={[styles.matrixDataCell, { flex: 0.8 }]}>{roomRes.aya}</Text>
                  <Text style={[styles.matrixDataCell, { flex: 0.8 }]}>{roomRes.vyaya}</Text>
                  <Text style={[styles.matrixDataCell, { flex: 1.2, fontSize: 9 }]}>{roomRes.yoni}</Text>
                  <Text style={[
                    styles.matrixDataCell, 
                    { 
                      flex: 1.2, 
                      fontWeight: '700',
                      color: roomRes.status === 'success' ? theme.colors.success : theme.colors.danger 
                    }
                  ]}>
                    {roomRes.status === 'success' ? (isTe ? "ఉత్తమం" : "Compliant") : (isTe ? "మధ్యమం" : "Correction")}
                  </Text>
                </View>
              );
            })}
          </View>
        </ScrollView>

        <View style={styles.sheetFooter}>
          <View style={styles.sheetFooterLine} />
          <Text style={styles.footerAddressText}>{officeAddress}</Text>
          <Text style={styles.footerCellText}>{contactCell}</Text>
          <Text style={styles.pageNumberText}>Page 3 of 4</Text>
        </View>
      </View>
    </View>
  );

  const renderPage4 = () => (
    <View style={styles.pdfSheet}>
      <View style={styles.sheetInnerFrame}>
        <View style={styles.sheetHeader}>
          <Text style={styles.devotionalText}>జై గురుదేవ 🙏 జై శ్రీ విశ్వకర్మ 🙏</Text>
          <Text style={styles.sheetTitle}>వాస్తు శాస్త్ర విశ్లేషణ పత్రం</Text>
          <Text style={styles.sheetSubtitle}>VASTU SHASTRA ANALYSIS REPORT</Text>
          <View style={styles.sheetDivider} />
        </View>

        <Text style={styles.sheetSectionTitle}>{isTe ? "4. ముఖ్యమైన సూచనలు" : "4. Auspicious Vastu Rules"}</Text>

        <View style={styles.tipsList}>
          {getVastuTips().map((tip, idx) => (
            <View key={idx} style={styles.tipListItem}>
              <View style={styles.tipListBullet} />
              <Text style={styles.tipListText}>{tip}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sheetSectionTitle}>{isTe ? "గమనిక / Disclaimer" : "Disclaimer"}</Text>
        <Text style={styles.disclaimerContentText}>
          {isTe 
            ? "గమనిక: ఈ నివేదిక మీ పేరు మరియు నక్షత్రం ఆధారంగా వాస్తు సిద్ధాంతాల ప్రకారం గణించబడింది. తుది నిర్మాణానికి ముందు అనుభవజ్ఞులైన వాస్తు సిద్ధాంతిని సంప్రదించి స్థలాన్ని ప్రత్యక్షంగా పరిశీలించాల్సిందిగా కోరుతున్నాము."
            : "Note: This Vastu report is computed offline based on static mathematical models. Prior to physical construction, please consult a certified Vastu consultant for direct layout confirmation."}
        </Text>

        <View style={styles.sheetFooter}>
          <View style={styles.sheetFooterLine} />
          <Text style={styles.footerAddressText}>{officeAddress}</Text>
          <Text style={styles.footerCellText}>{contactCell}</Text>
          <Text style={styles.pageNumberText}>Page 4 of 4</Text>
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      
      {/* Page Thumbnails selector */}
      <View style={styles.thumbnailsBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbsScroll}>
          {[1, 2, 3, 4].map(p => (
            <TouchableOpacity 
              key={p} 
              style={[styles.thumbCard, selectedPage === p && styles.thumbCardActive]}
              onPress={() => setSelectedPage(p)}
              activeOpacity={0.8}
            >
              <View style={styles.thumbSheetMock}>
                <Ionicons name="document-text-outline" size={16} color={selectedPage === p ? theme.colors.primary : theme.colors.textSecondary} />
              </View>
              <Text style={[styles.thumbText, selectedPage === p && styles.thumbTextActive]}>Page {p}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        
        <View style={styles.actionsBar}>
          <TouchableOpacity style={styles.actionBtn} onPress={triggerPrint}>
            <Ionicons name="print-outline" size={16} color={theme.colors.text} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={triggerDownload}>
            <Ionicons name="cloud-download-outline" size={16} color={theme.colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Selected Page visual area */}
      {Platform.OS === 'web' ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.sheetWorkspace}>
          {selectedPage === 1 && renderPage1()}
          {selectedPage === 2 && renderPage2()}
          {selectedPage === 3 && renderPage3()}
          {selectedPage === 4 && renderPage4()}
          
          <VastuFooter 
            language={language}
            theme={theme}
            activeTheme={theme.colors.background === '#121212' ? 'dark' : (theme.colors.primary === '#990000' ? 'crimson' : 'light')} 
            style={{ marginHorizontal: -16, marginBottom: -16, marginTop: 40 }}
          />
        </ScrollView>
      ) : (
        <View style={styles.sheetWorkspace}>
          {selectedPage === 1 && renderPage1()}
          {selectedPage === 2 && renderPage2()}
          {selectedPage === 3 && renderPage3()}
          {selectedPage === 4 && renderPage4()}
        </View>
      )}

    </View>
  );
}

const getStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    paddingBottom: Platform.OS === 'web' ? 24 : 110,
    ...(Platform.OS === 'web' ? { height: '100%', maxHeight: '100%', overflow: 'hidden' } : {}),
  },
  thumbnailsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1.2,
    borderBottomColor: theme.colors.border,
  },
  thumbsScroll: {
    gap: 12,
    paddingRight: 16,
  },
  thumbCard: {
    alignItems: 'center',
    gap: 4,
    borderWidth: 1.5,
    borderColor: 'transparent',
    borderRadius: 6,
    padding: 2,
  },
  thumbCardActive: {
    borderColor: theme.colors.primary,
  },
  thumbSheetMock: {
    width: 32,
    height: 42,
    backgroundColor: theme.colors.primaryLight,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  thumbText: {
    fontSize: 9,
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
  thumbTextActive: {
    color: theme.colors.primary,
    fontWeight: '700',
  },
  actionsBar: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    borderWidth: 1.2,
    borderColor: theme.colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  sheetWorkspace: {
    flex: 1,
    padding: 16,
    alignItems: 'center',
  },
  pdfSheet: {
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: theme.colors.primary, // Sharp navy outer border
    borderRadius: 4,
    padding: 6, // Small gap for inner gold border
    width: '100%',
    minHeight: 520,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3,
  },
  sheetInnerFrame: {
    borderWidth: 1.2,
    borderColor: theme.colors.accent, // Gold accent inner border
    padding: 16,
    flex: 1,
    minHeight: 504,
    justifyContent: 'space-between',
  },
  sheetHeader: {
    alignItems: 'center',
    marginBottom: 12,
  },
  devotionalText: {
    fontSize: 9,
    fontWeight: '750',
    color: theme.colors.textSecondary,
    marginBottom: 2,
  },
  sheetTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: theme.colors.primary,
    textAlign: 'center',
  },
  sheetSubtitle: {
    fontSize: 9,
    fontWeight: '700',
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginTop: 2,
  },
  sheetDivider: {
    width: '100%',
    height: 1.5,
    backgroundColor: theme.colors.primary,
    marginTop: 6,
  },
  sheetSectionTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: theme.colors.primary,
    marginVertical: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sheetTable: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#FAFBFD',
  },
  sheetTableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  sheetTableCellLabel: {
    flex: 1,
    fontSize: 11,
    color: theme.colors.textSecondary,
  },
  sheetTableCellValue: {
    flex: 1.2,
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.text,
    textAlign: 'right',
  },
  blueprintSheetCard: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 6,
    padding: 12,
    alignItems: 'center',
  },
  blueprintMockFrame: {
    width: 140,
    height: 140,
    borderWidth: 1.2,
    borderColor: '#64748B',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    position: 'relative',
  },
  northIndicatorBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: theme.colors.primaryLight,
    width: 16,
    height: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  northText: {
    fontSize: 8,
    fontWeight: '800',
    color: theme.colors.primary,
  },
  blueprintTitleLabel: {
    fontSize: 8,
    color: theme.colors.textSecondary,
    marginBottom: 6,
  },
  blueprintMainBuilding: {
    width: 90,
    height: 90,
    borderWidth: 1.5,
    borderColor: theme.colors.primary,
    backgroundColor: 'rgba(7, 2, 98, 0.04)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  blueprintMainLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: theme.colors.primary,
    textAlign: 'center',
  },
  blueprintDetailsLine: {
    fontSize: 9,
    color: theme.colors.textSecondary,
    marginTop: 6,
    fontWeight: '600',
  },
  pdfEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2563EB',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    marginTop: 8,
  },
  pdfEditBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  reportMatrixTable: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  matrixHeaderRow: {
    flexDirection: 'row',
    backgroundColor: theme.colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  matrixHeaderCell: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'center',
  },
  matrixDataRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
    alignItems: 'center',
  },
  matrixDataCell: {
    fontSize: 10,
    color: theme.colors.text,
    textAlign: 'center',
  },
  tipsList: {
    gap: 6,
  },
  tipListItem: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'flex-start',
  },
  tipListBullet: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: theme.colors.accent,
    marginTop: 5,
  },
  tipListText: {
    fontSize: 10,
    color: theme.colors.text,
    lineHeight: 14,
    flex: 1,
  },
  disclaimerContentText: {
    fontSize: 9,
    color: theme.colors.textSecondary,
    fontStyle: 'italic',
    lineHeight: 13,
  },
  sheetFooter: {
    marginTop: 'auto',
    alignItems: 'center',
    paddingTop: 8,
  },
  sheetFooterLine: {
    width: '100%',
    height: 1,
    backgroundColor: theme.colors.border,
    marginBottom: 6,
  },
  footerAddressText: {
    fontSize: 8,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  footerCellText: {
    fontSize: 8,
    fontWeight: '700',
    color: theme.colors.text,
    marginTop: 2,
  },
  pageNumberText: {
    fontSize: 8,
    color: theme.colors.textSecondary,
    marginTop: 2,
  }
});
