# Synthetic portfolio fixture — NOT Al Ghurair data

`portfolio_demo.csv` contains made-up summary figures for documentation and UAT planning. It is not a balanced GL, a legal-entity hierarchy, a source TB, a group consolidation or a production import specification. Synthetic Investment zeros mean explicitly entered zero, not missing. Under the assumed reporting definition in `docs/14-al-ghurair-group-pilot.md`, operating revenue is AED 3,100; operating expense AED 2,250; EBITDA-like subtotal AED 850 only if finance approves those component classifications; dividend AED 100 is shown separately. Label totals 'unadjusted management sum — not consolidated'.

Negative test fixtures are not yet built: use a separate missing-status representation; deleting a row alone must not be interpreted as an intentional zero. Finance approval, app tests and Excel tests have not occurred.
