# Aliquot

A LIMS and electronic lab notebook for contract analytical laboratories: samples in, tested against methods, reviewed, certified and billed.

## Language

### Product

**Module**:
A top-level area of Aliquot that a lab sees as one thing, such as Samples, Methods or Invoices.
_Avoid_: Feature, section, page

**Operator**:
The person who hosts Aliquot for a lab. Not a role inside the lab.
_Avoid_: Admin, owner, vendor

**Staff app**:
The part of Aliquot used by the lab's own people.
_Avoid_: Back office, admin site, LIMS (for this part alone)

**Client portal**:
The separate part of Aliquot where a client's contacts follow their own samples, download CoAs and message the lab.
_Avoid_: Customer site, extranet

### Lab work

**Method**:
A defined analytical procedure, with its analytes, specifications and price, that a lab is qualified to run.
_Avoid_: Procedure, assay, SOP

**Test**:
One application of a Method to one Sample, carried from assignment through performed, reviewed and approved. Belongs to the Samples module: Worklist and Reviews & approvals are queues of Tests, not their owners.
_Avoid_: Analysis, job

**OOS investigation**:
The inquiry that opens when a Test result is out of specification. It blocks approval and certification until someone independent of the analyst closes it with a root cause and conclusion.
_Avoid_: OOS form, deviation

**Certificate of Analysis (CoA)**:
The QA-signed statement of a Sample's approved results, issued to the client.
_Avoid_: Report, certificate
