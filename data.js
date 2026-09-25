/* Credit-controls demo: data.
   Everything here is demo data: clinic, patients, charges, cards and dates are made up, relative to today.
   Nothing calls a payment gateway. Ticket keys, names and internal field names live only in the SPEC block
   at the end, so the public share build swaps that block and nothing else. */
(function () {
  const D = (window.DEMO = {});

  D.META = { title: 'Clinic credit controls', version: 'Demo v1', date: 'Sep 24, 2026' };
  D.CLINIC = 'Mock Wellness Clinic';
  /* A multi-location account. Each location (clinic) has its own card and its own backlog. */
  D.LOCATIONS = [
    { id: 4312, name: 'Mock Wellness Clinic', card: { brand: 'Visa', last4: '4242', exp: '08/27' } },
    { id: 4318, name: 'Mock Wellness Clinic - Santa Monica', card: { brand: 'Mastercard', last4: '5454', exp: '11/28' } },
  ];

  /* Only what clinics are shown. The pause thresholds are super-admin settings and stay out of clinic copy
     and out of this file (Support, Sep 24: publishing them invites clinics to stay just under them). */
  D.LIMITS = { retryHours: [24, 48, 72], perPage: 10, exportFrom: '2025-03-01' };

  /* The account states, in the order the ladder climbs. tries = the quick links in the scenario strip. */
  D.SCENARIOS = [
    { id: 'ok', label: 'All paid', short: 'All paid',
      what: 'Nothing owed. Billing says "Account active" and lists every charge, 10 per page.',
      tries: [['Open Billing', 'go:billing'], ['Export a date range', 'export']] },
    { id: 'retrying', label: 'Retrying', short: 'Retrying',
      what: 'A charge failed and the automatic retries are still running. Nothing is paused.',
      tries: [['See the banner on Results', 'go:results'], ['Update card', 'card:update']] },
    { id: 'gfe_only', label: 'Rx paused', short: 'Rx paused',
      what: 'Retries finished with 2 unpaid charges. Prescription exams are paused; Good Faith Exams still work.',
      tries: [['Send Exam Invite (Rx types locked)', 'invite'], ['Pay balance', 'card:pay']] },
    { id: 'blocked', label: 'Exams paused', short: 'Exams paused',
      what: '5 unpaid charges ($424.95). Sending new exams is paused until the balance is paid.',
      tries: [['Send Exam Invite (opens the card screen)', 'invite'], ['Open Billing', 'go:billing']] },
    { id: 'backlog', label: '300 unpaid', short: '300 unpaid',
      what: 'A backlog of 300 unpaid charges at go-live. Billing pages 10 at a time, and the card screen shows 10 and links to the rest.',
      tries: [['Billing: Unpaid, page by page', 'billing:unpaid'], ['Filter a date range and export it', 'export']] },
    { id: 'hold', label: 'On hold', short: 'On hold',
      what: 'Our team put a hold on the account. Nothing is owed, so a new card can\'t lift it.',
      tries: [['Send Exam Invite', 'invite'], ['Open Billing', 'go:billing']] },
  ];
  D.DEFAULT_SCENARIO = 'blocked';

  /* Clinic-facing decline wording. Gateway codes map onto these. */
  D.DECLINE = { insufficient: 'insufficient funds', expired: 'card expired', bank: 'declined by the bank' };

  /* What each exam type costs in the demo: the exam fee and, for QualiphyRx, the medication. */
  D.CHARGE_TYPES = {
    gfe: { description: 'Good Faith Exam', fee: 27.99, med: 0 },
    rx: { description: 'QualiphyRx consultation + medication', fee: 29.99, med: 89 },
    uc: { description: 'Urgent care visit', fee: 39.99, med: 0 },
  };

  /* Test cards for the card form. Real card details can't be typed into this demo. */
  D.DEMO_CARDS = [
    { last4: '1881', brand: 'Visa', label: 'Visa ending 1881', outcome: 'approves' },
    { last4: '0002', brand: 'Visa', label: 'Visa ending 0002', outcome: 'declines' },
  ];

  D.STATE_OPTIONS = ['California', 'Arizona', 'Texas', 'Florida', 'New York'];

  /* The consultation types on Invite Patient. rx = can lead to a prescription, so it's paused at "Rx paused". */
  D.CONSULT_TYPES = [
    { id: 'gfe', label: 'Good Faith Exam & Orders', rx: false },
    { id: 'rx', label: 'QualiphyRx Packages: Consultation + Medication Delivery Made Easy', rx: true },
    { id: 'uc', label: 'Urgent Care Visit: Consultation + Prescription Sent to Your Pharmacy', rx: true },
    { id: 'pharmacy', label: 'Choose Your Pharmacy (Consultation and Prescription Only)', rx: true },
  ];
  D.EXAMS_BY_TYPE = {
    gfe: ['IV Therapy Good Faith Exam', 'Botox & Filler Good Faith Exam', 'Weight Loss Good Faith Exam'],
    rx: ['GLP-1 Weight Loss Exam (Semaglutide)', 'GLP-1 Weight Loss Exam (Tirzepatide)'],
    uc: ['Urgent Care Visit'],
    pharmacy: ['GLP-1 Weight Loss Exam (Semaglutide), your pharmacy'],
  };

  /* Rows on the Results page (Patient Exams). Made-up patients. ago = days before today. */
  D.RESULTS = [
    { id: 16490231, name: 'Ava Martinez', exam: 'GLP-1 Weight Loss Exam (Tirzepatide)', status: 'Approved', ago: 1, sent: '11:12 AM', done: '11:41 AM' },
    { id: 16490198, name: 'Noel Kim', exam: 'IV Therapy Good Faith Exam', status: 'Approved', ago: 1, sent: '9:03 AM', done: '9:22 AM' },
    { id: 16490112, name: 'Sophia Nguyen', exam: 'Botox & Filler Good Faith Exam', status: 'Pending', ago: 2, sent: '2:45 PM', done: '' },
    { id: 16489967, name: 'Liam Patel', exam: 'GLP-1 Weight Loss Exam (Semaglutide)', status: 'In Review', ago: 2, sent: '10:30 AM', done: '10:58 AM' },
    { id: 16489873, name: 'Grace Okoro', exam: 'IV Therapy Good Faith Exam', status: 'Approved', ago: 3, sent: '4:05 PM', done: '4:31 PM' },
    { id: 16489790, name: 'Mateo Rossi', exam: 'Urgent Care Visit', status: 'Approved', ago: 3, sent: '1:17 PM', done: '1:52 PM' },
  ];

  /* ---------------------------------------------------------------- SPEC (public share build)
     Same keys as the private SPEC block in v1/data.js, without ticket keys, colleague names, internal field
     names or known-defect details. Edit both when the design changes. */
  D.SPEC = {
    audience: '',
    support: 'support@qualiphy.me',
    tickets: {},
    exportToday: 'Settings already has Export Billing with a date range (clinics can export from Mar 1, 2025). The demo adds the same export to Billing, with a status filter.',
    fromReview: [
      ['Pages, not a long list', 'Billing shows 10 charges per page, with the portal\'s existing page control (Medication Management). The card screen lists 10 and links to the rest.'],
      ['Export by time period', 'Billing gets a date-range filter and an Export button. It exports exactly what\'s filtered, in every status, including failed and collections charges.'],
      ['Support line', '"If you need more clarification on these charges, please contact support@qualiphy.me" on Billing and on the card screen.'],
      ['Support: IDs and amounts', 'The exam fee and medication as separate amounts, the patient profile ID, and the Clinic ID on every row, so a screenshot is enough for Support to find the exam.'],
      ['Support: location filter', 'Multi-location accounts filter charges by location. The balance and the card follow the filter, because each location has its own card.'],
      ['Support: no thresholds', 'Clinic copy doesn\'t state the pause limits, so clinics can\'t aim just under them. The retry schedule is still shown.'],
    ],
    defaults: [
      'Patients see a neutral "online consultations aren\'t available" page that never mentions payment.',
      'Anyone logged into the clinic account can update the card, until roles land.',
      'One charge for the full balance.',
      'Clinics can pay early from Billing, or retry the card on file when the decline wasn\'t an expired card.',
      '"In collections" charges show as such and are included in the payoff. No data flag exists for this yet (see the questions).',
      'Nothing is restricted while automatic retries are still running.',
      'Exams already in progress always finish; only new actions are refused.',
    ],
    questions: [
      ['Engineering', 'Should prescriptions pause at the first failed charge, or only after the 24/48/72-hour retries finish? The demo waits until retries are exhausted.'],
      ['Engineering', 'A 300-charge backlog is {backlog} in one charge, which many cards will refuse. Allow paying part of it, or send large balances to an invoice?'],
      ['Product', 'Under the pause limits a clinic is paused long before 300 charges. How many clinics start with a backlog on day one, and do they get notice first?'],
      ['Product', 'Should the Billing export replace Settings › Export Billing, or both stay?'],
      ['Engineering', 'Nothing marks a charge as "in collections" yet. Add a ledger status that Finance sets when they take a charge over, or drop "In collections" from the clinic view?'],
      ['Engineering', 'Each location has its own card and backlog. Is the block per location (only the location that owes), or per account?'],
    ],
    engineering: [
      ['API path', 'Return a refusal instead of the page: { "http_code": 402, "error_code": "CREDIT_CONTROL_BLOCK", "block_level": "gfe_only | full | hold", "balance_due": 424.95 }.'],
      ['Paging', 'Server-side, 10 per page, sorted newest first; the filters (status, date range) go to the query. Reuse the Medication Management page control.'],
      ['Export', 'The existing billing export already takes a start and end date. Add a status filter and include failed and collections rows.'],
      ['Decline reasons', 'Map gateway codes to three clinic-facing reasons: insufficient funds, card expired, declined by the bank.'],
      ['Card form', 'The demo form is a stand-in for the portal\'s existing card form.'],
      ['Direct-bill clinics', 'Clinics billed directly never see any of this.'],
      ['Numbers', 'Balances and statuses come from the payments ledger.'],
      ['Rx signal', 'The locked types are the consultation types that can lead to a prescription.'],
    ],
  };
})();
