report 50100 "Contoso Verkaufsrechnung"
{
    Caption = 'Verkaufsrechnung';
    DefaultRenderingLayout = RDLCLayout;

    dataset
    {
        dataitem(Header; "Sales Invoice Header")
        {
            column(CompanyName; CompanyProperty.DisplayName()) { }
            column(No_SalesInvHdr; "No.") { }
            column(DocDate_SalesInvHdr; "Document Date") { }
            column(Paid; Closed) { }
            column(Description_Lbl; DescriptionLbl) { }
            // added after the layout was last generated: the linter reports the layout as outdated
            column(YourReference; "Your Reference") { IncludeCaption = true; }

            dataitem(Line; "Sales Invoice Line")
            {
                DataItemLink = "Document No." = field("No.");
                column(LineNo_Line; "Line No.") { }
                column(Description_Line; Description) { }
                column(Quantity_Line; Quantity) { }
                column(UnitPrice_Line; "Unit Price") { }
                column(LineAmount_Line; "Line Amount") { }
            }
        }
    }

    rendering
    {
        layout(RDLCLayout)
        {
            Type = RDLC;
            LayoutFile = './Verkaufsrechnung.rdlc';
        }
    }

    var
        DescriptionLbl: Label 'Beschreibung';
}
