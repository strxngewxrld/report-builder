import { Report, emptyReport, newId } from './model';
import { DEFAULT_TEXT_STYLE } from './ops';

/** The blank report Report Builder starts with: a title in the body and the execution time in the page footer. */
export function newReportTemplate(): Report {
  const r = emptyReport();
  r.body.items.push({
    id: newId(), type: 'textbox', name: 'ReportTitle', value: 'Klicken Sie hier, um einen Titel hinzuzufügen', canGrow: true,
    top: 0, left: 0, width: 6.5, height: 0.4,
    style: { ...DEFAULT_TEXT_STYLE, FontFamily: 'Segoe UI Light', FontSize: '20pt', VerticalAlign: 'Middle' },
  });
  r.footer = {
    height: 0.45,
    style: {},
    items: [{
      id: newId(), type: 'textbox', name: 'ExecutionTime', value: '=Globals!ExecutionTime', canGrow: true,
      top: 0.2, left: 4.5, width: 2, height: 0.25, style: { ...DEFAULT_TEXT_STYLE, TextAlign: 'Right' },
    }],
  };
  return r;
}
