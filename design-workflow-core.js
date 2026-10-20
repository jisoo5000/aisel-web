/*
 * AISEL design workflow domain contract (no I/O, DOM, storage, or implicit clock).
 * UMD: window.AiselDesignWorkflowCore / require('./design-workflow-core.js').
 *
 * summarizeMeeting({ designer, meetingDate:'YYYY-MM-DD', now, sourceState, records,
 *                    additionalCount? })
 * - sourceState:'ready' means the caller has fetched the complete relevant source.
 *   Missing/loading/partial/error sources MUST NOT be passed as ready.
 * - records: [{code OR id, designer: ORIGINAL designer string,
 *     workflow:{meetingDate, slot:'general'|'comfort-pants'|'comfort-skirt',
 *               additional:boolean, submittedAt: epochMs OR zonedISO OR null}}].
 * - workflow is explicit persisted metadata; the adapter may parse designWorkflowJson.
 *   A comfort slot explicitly means NEW material work. Never infer it from product name.
 * - submittedAt is first successfully uploaded COMPLETED workorder time, immutable once
 *   established. createdAt, updatedAt, factory, category, status and sample data are NOT
 *   completion evidence. Missing historical evidence stays pending/unknown; the caller
 *   must retain separately verified manual overrides with their real provenance.
 * - additional:true means an explicit representative-requested extra, not overflow.
 *   Optional additionalCount is the total explicit extra target, including uncreated
 *   workorders. It cannot be lower than the unique extra workorders in the source.
 * - A repeated code/id counts once. Compatible revision copies use the earliest known
 *   submittedAt; conflicting assignments are unknown, never silently reassigned.
 * - Deadline is meeting-day 24:00 Asia/Seoul, inclusive at the exact boundary.
 *   Inputs and all numeric timestamps use milliseconds. Zoned ISO strings only.
 * - counts represent unique submitted documents. credited counts cap each base slot;
 *   general overflow cannot replace comfort slots or explicit extras.
 * - unknown aggregate counts are null, not zero. observed is a lower-bound snapshot.
 *   Missing assigned work remains incomplete after the deadline. A fully met target
 *   reached after deadline is late; before deadline an unmet target is ongoing.
 *
 * productionOrderStatus(record,{sourceState,now}): explicit record.productionOrder =
 * {requestedAt,requestedBy,confirmation:{kind:'production-order',orderedAt,
 *                                      confirmedBy,reference}}.
 * A production confirmation needs all four fields, an actual (not future) timestamp,
 * and a durable reference (order number/document/acknowledgement). Legacy status,
 * a factory assignment, sample request, draft or request alone never means ordered.
 * This validates evidence shape, not the external document or identity's authority.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AiselDesignWorkflowCore = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DAY = 86400000;
  const KST = 9 * 3600000;
  const SLOTS = ['general', 'comfort-pants', 'comfort-skirt'];
  const POLICIES = {
    eunyoung: {id:'eunyoung', name:'은영', weekday:2, baseline:6,
      slots:{general:6, 'comfort-pants':0, 'comfort-skirt':0}},
    hyeju: {id:'hyeju', name:'혜주', weekday:4, baseline:8,
      slots:{general:6, 'comfort-pants':1, 'comfort-skirt':1}}
  };
  const ALIASES = {은영:'eunyoung', 장은영:'eunyoung', eunyoung:'eunyoung',
    혜주:'hyeju', 강혜주:'hyeju', hyeju:'hyeju'};
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const text = value => typeof value === 'string' ? value.trim() : '';
  const blankCounts = () => ({general:0, 'comfort-pants':0, 'comfort-skirt':0, additional:0});

  function getPolicy(designer) {
    const alias = text(designer).replace(/\s/g, '').replace(/님$/, '');
    const policy = POLICIES[ALIASES[alias]];
    return policy ? {...policy, slots:{...policy.slots}} : null;
  }

  function timestamp(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 &&
      !Number.isNaN(new Date(value).getTime()) ? value : null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
    const parsed = Date.parse(value);
    // Date.parse normalizes impossible dates such as February 30; reject them.
    if (!validDate(value.slice(0, 10)) || !Number.isFinite(parsed) || parsed < 0) return null;
    return parsed;
  }

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
  }

  function requiredNow(value) {
    const time = timestamp(value);
    if (time === null) throw new TypeError('now must be epoch milliseconds or a zoned ISO timestamp');
    return time;
  }

  function kstDate(value) {
    return new Date(requiredNow(value) + KST).toISOString().slice(0, 10);
  }

  function shiftDate(value, days) {
    return new Date(Date.parse(value + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
  }

  function meetingWindow(meetingDate, designer) {
    if (!validDate(meetingDate)) throw new TypeError('meetingDate must be a real YYYY-MM-DD date');
    const policy = getPolicy(designer);
    if (!policy) throw new RangeError('Unknown designer policy');
    const day = Date.parse(meetingDate + 'T00:00:00Z');
    if (new Date(day).getUTCDay() !== policy.weekday) throw new RangeError('meetingDate does not match the designer meeting weekday');
    const startAt = day - KST + 15 * 3600000;
    const deadlineAt = day - KST + DAY;
    return {meetingDate, timeZone:'Asia/Seoul', startAt, deadlineAt,
      startsAt:meetingDate + 'T15:00:00+09:00',
      deadline:shiftDate(meetingDate, 1) + 'T00:00:00+09:00'};
  }

  function meetingWeek(designer, now) {
    const policy = getPolicy(designer);
    if (!policy) throw new RangeError('Unknown designer policy');
    const today = kstDate(now);
    const weekday = new Date(today + 'T00:00:00Z').getUTCDay();
    const meetingDate = shiftDate(today, -((weekday - policy.weekday + 7) % 7));
    return {...meetingWindow(meetingDate, designer), previousMeetingDate:shiftDate(meetingDate, -7),
      nextMeetingDate:shiftDate(meetingDate, 7)};
  }

  // New work belongs to the upcoming meeting, including the meeting's local day.
  // This is a proposal for the caller to persist once, never a historical inference.
  function suggestMeetingDate(designer, now) {
    const policy = getPolicy(designer);
    if (!policy) throw new RangeError('Unknown designer policy');
    const today = kstDate(now);
    const weekday = new Date(today + 'T00:00:00Z').getUTCDay();
    return shiftDate(today, (policy.weekday - weekday + 7) % 7);
  }

  function summaryCounts(bySlot, policy, additionalTarget) {
    const creditedBySlot = blankCounts();
    let total = 0, credited = 0;
    for (const slot of SLOTS) {
      total += bySlot[slot];
      creditedBySlot[slot] = Math.min(bySlot[slot], policy.slots[slot]);
      credited += creditedBySlot[slot];
    }
    total += bySlot.additional;
    creditedBySlot.additional = Math.min(bySlot.additional, additionalTarget);
    credited += creditedBySlot.additional;
    return {total, credited, bySlot:{...bySlot}, creditedBySlot};
  }

  function summarizeMeeting(input) {
    if (!input || typeof input !== 'object') throw new TypeError('Meeting input is required');
    const {designer, meetingDate} = input;
    const policy = getPolicy(designer);
    if (!policy) throw new RangeError('Unknown designer policy');
    const window = meetingWindow(meetingDate, designer);
    const now = requiredNow(input.now);
    const issues = [], groups = new Map();
    const sourceReady = input.sourceState === 'ready' && Array.isArray(input.records);
    const records = Array.isArray(input.records) ? input.records : [];
    const hasAdditionalTarget = own(input, 'additionalCount');
    if (hasAdditionalTarget && (!Number.isSafeInteger(input.additionalCount) || input.additionalCount < 0)) {
      throw new TypeError('additionalCount must be a non-negative integer');
    }
    let unassignedCount = 0, invalidCount = 0;
    records.forEach((record, index) => {
      if (!record || typeof record !== 'object') { issues.push({code:'invalid-record', index}); invalidCount++; return; }
      const recordPolicy = getPolicy(record.designer);
      // Keep all revisions of a known identity, including conflicting owners/dates.
      const id = text(record.code) || text(record.id);
      if (id) {
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id).push(record);
      } else if (recordPolicy?.id === policy.id && record.workflow?.meetingDate === meetingDate) {
        issues.push({code:'missing-identity', index}); invalidCount++;
      }
      if (recordPolicy?.id === policy.id && !record.workflow?.meetingDate) unassignedCount++;
    });

    const onTimeSlots = blankCounts(), lateSlots = blankCounts(), allSlots = blankCounts();
    const items = [];
    let extraCount = 0, pendingCount = 0, relevantCount = 0;
    for (const [id, revisions] of groups) {
      const relevant = revisions.some(record => getPolicy(record.designer)?.id === policy.id &&
        record.workflow?.meetingDate === meetingDate);
      if (!relevant) continue;
      relevantCount++;
      const signatures = new Set(revisions.map(record => JSON.stringify([
        getPolicy(record.designer)?.id || text(record.designer), record.workflow?.meetingDate,
        record.workflow?.slot, record.workflow?.additional])));
      if (signatures.size !== 1) {
        issues.push({code:'conflicting-assignment', id}); invalidCount++;
        items.push({id, status:'unknown', reason:'conflicting-assignment'}); continue;
      }
      const record = revisions[0], workflow = record.workflow;
      if (!SLOTS.includes(workflow.slot) || typeof workflow.additional !== 'boolean') {
        issues.push({code:'invalid-workflow', id}); invalidCount++;
        items.push({id, status:'unknown', reason:'invalid-workflow'}); continue;
      }
      if (workflow.additional) extraCount++;
      const bucket = workflow.additional ? 'additional' :
        policy.id === 'eunyoung' ? 'general' : workflow.slot;
      const stamps = [];
      let invalidStamp = false;
      for (const revision of revisions) {
        const value = revision.workflow.submittedAt;
        if (value === null || value === undefined || value === '') continue;
        const parsed = timestamp(value);
        if (parsed === null) invalidStamp = true;
        else stamps.push(parsed);
      }
      if (invalidStamp) {
        issues.push({code:'invalid-submission-time', id}); invalidCount++;
        items.push({id, status:'unknown', reason:'invalid-submission-time'}); continue;
      }
      const submittedAt = stamps.length ? Math.min(...stamps) : null;
      if (submittedAt !== null && submittedAt > now) {
        issues.push({code:'future-submission-time', id}); invalidCount++;
        items.push({id, status:'unknown', reason:'future-submission-time'}); continue;
      }
      const status = submittedAt === null ? 'pending' : submittedAt <= window.deadlineAt ? 'on-time' : 'late';
      items.push({id, designer:record.designer, slot:workflow.slot, additional:workflow.additional,
        submittedAt, status});
      if (status === 'pending') pendingCount++;
      else {
        allSlots[bucket]++;
        (status === 'on-time' ? onTimeSlots : lateSlots)[bucket]++;
      }
    }
    if (hasAdditionalTarget && input.additionalCount < extraCount) {
      throw new RangeError('additionalCount cannot be lower than explicit unique extra workorders');
    }
    const additionalTarget = hasAdditionalTarget ? input.additionalCount : extraCount;
    const observedTarget = policy.baseline + additionalTarget;
    const onTime = summaryCounts(onTimeSlots, policy, additionalTarget);
    const late = summaryCounts(lateSlots, policy, additionalTarget);
    const completed = summaryCounts(allSlots, policy, additionalTarget);
    // Unassigned legacy documents cannot prove a deficit. They do not invalidate an
    // already evidenced complete result or silently migrate into this meeting.
    const unresolvedAssignment = unassignedCount > 0 && completed.credited < observedTarget;
    const trustworthy = sourceReady && invalidCount === 0 && !unresolvedAssignment;
    const targetKnown = (sourceReady && invalidCount === 0) || hasAdditionalTarget;
    const target = targetKnown ? observedTarget : null;
    let status = 'unknown';
    if (trustworthy) {
      status = onTime.credited >= observedTarget ? 'complete' : now <= window.deadlineAt ? 'ongoing' :
        completed.credited >= observedTarget ? 'late' : 'incomplete';
    }
    if (!sourceReady) issues.push({code:'source-not-ready', state:input.sourceState || 'unknown'});
    if (unresolvedAssignment) issues.push({code:'unassigned-workorders', count:unassignedCount});
    const observed = {target:observedTarget, additionalTarget, assigned:relevantCount, onTime:onTime.total,
      late:late.total, pending:pendingCount, completed:completed.total, credited:completed.credited,
      creditedOnTime:onTime.credited, missing:Math.max(0, observedTarget - completed.credited),
      missingAtDeadline:Math.max(0, observedTarget - onTime.credited),
      onTimeBySlot:onTime.bySlot, lateBySlot:late.bySlot, creditedBySlot:completed.creditedBySlot};
    return {...window, designer, designerId:policy.id, baseline:policy.baseline, baselineBySlot:{...policy.slots},
      status, sourceState:input.sourceState || 'unknown', reliable:trustworthy, target,
      additionalTarget:targetKnown ? additionalTarget : null,
      onTime:trustworthy ? observed.onTime : null, late:trustworthy ? observed.late : null,
      pending:trustworthy ? observed.pending : null, completed:trustworthy ? observed.completed : null,
      credited:trustworthy ? observed.credited : null, creditedOnTime:trustworthy ? observed.creditedOnTime : null,
      missing:trustworthy ? observed.missing : null, missingAtDeadline:trustworthy ? observed.missingAtDeadline : null,
      slots:trustworthy ? SLOTS.map(slot => ({slot, target:policy.slots[slot],
        completed:completed.bySlot[slot], onTime:onTime.bySlot[slot],
        credited:completed.creditedBySlot[slot], missing:Math.max(0, policy.slots[slot] - completed.bySlot[slot])})) : null,
      observed, items, issues, unassignedCount};
  }

  function productionOrderStatus(record, options) {
    options = options || {};
    const now = requiredNow(options.now);
    if (options.sourceState !== 'ready' || !record || typeof record !== 'object') {
      return {status:'unknown', requestedAt:null, orderedAt:null, reason:'source-not-ready'};
    }
    const order = record.productionOrder;
    if (!order) return {status:'not-requested', requestedAt:null, orderedAt:null, reason:'no-explicit-request'};
    const requestTime = timestamp(order.requestedAt);
    const requestValid = requestTime !== null && requestTime <= now && !!text(order.requestedBy);
    const confirmation = order.confirmation;
    const orderTime = timestamp(confirmation?.orderedAt);
    const confirmed = confirmation?.kind === 'production-order' && orderTime !== null && orderTime <= now &&
      !!text(confirmation.confirmedBy) && !!text(confirmation.reference) &&
      (!requestValid || orderTime >= requestTime);
    if (confirmed) return {status:'ordered', requestedAt:requestValid ? requestTime : null,
      orderedAt:orderTime, confirmedBy:confirmation.confirmedBy, reference:confirmation.reference,
      reason:'explicit-production-order-evidence'};
    if (requestValid) return {status:'requested', requestedAt:requestTime, orderedAt:null,
      reason:confirmation ? 'unverified-production-confirmation' : 'awaiting-production-confirmation'};
    return {status:'unknown', requestedAt:null, orderedAt:null, reason:'invalid-production-order-evidence'};
  }

  return Object.freeze({version:1, getPolicy, timestamp, validDate, kstDate, meetingWindow,
    meetingWeek, suggestMeetingDate, summarizeMeeting, productionOrderStatus});
}));
