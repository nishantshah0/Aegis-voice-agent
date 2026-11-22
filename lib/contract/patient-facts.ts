import type { ButtonOutputs } from "./buttons";
import type { Prescription } from "./store";

const dateLabel = new Intl.DateTimeFormat("en-US", {
  month: "long", day: "numeric", year: "numeric", timeZone: "America/Toronto",
});
const money = /^\$\d+\.\d{2}$/;

export function lastFillFacts(rx: Prescription) {
  const quantity = rx.lastDispensedQuantity;
  const supply = `a ${rx.daysSupplied}-day supply`;
  const fill = quantity
    ? `with ${quantity.count} ${quantity.unit} for ${supply}`
    : `for ${supply}; the dispensed quantity is not recorded`;
  return {
    days_supplied: rx.daysSupplied,
    last_quantity: quantity?.count ?? null,
    last_quantity_unit: quantity?.unit ?? null,
    history_readback: `Your last fill of ${rx.drug} was ${dateLabel.format(new Date(rx.lastFill))}, ${fill} and ${rx.refillsLeft} refill${rx.refillsLeft === 1 ? "" : "s"} remaining.`,
  };
}

export function coverageFacts(rx: Prescription, days = rx.daysSupplied): ButtonOutputs["check_coverage"] {
  const quote = days === rx.daysSupplied ? rx : rx.supplyQuotes?.find(entry => entry.days === days);
  const available = !!quote && money.test(quote.planPays) && money.test(quote.patientPays);
  return {
    rx_id: rx.id,
    drug: rx.drug,
    days_supply: days,
    available,
    plan_pays: available ? quote.planPays : null,
    patient_pays: available ? quote.patientPays : null,
    coverage_readback: available
      ? `For a ${days}-day supply of ${rx.drug}, your plan pays ${quote.planPays} and your share is ${quote.patientPays}.`
      : `I don't have an insurance quote for a ${days}-day supply of ${rx.drug}.`,
  };
}
