import { Link } from 'react-router-dom';

const chapters = [
  ['The request', 'Autonomy is not authority.', 'An agent can propose an action. That identity alone grants no right to move assets or execute a tool.'],
  ['The boundary', 'Permission has a shape.', 'Account, chain, target, recipient, amount and expiry define an explicit policy scope.'],
  ['The decision', 'A decision is not a signature.', 'A blocked action stops. An approval-required action waits.'],
  ['The execution', 'Enforce where it happens.', 'An enrolled agent signs the exact authorization and outer transaction.'],
  ['The evidence', 'Submitted is not settled.', 'A receipt and reconciliation establish later facts; reverts and reorgs remain visible.'],
  ['The control plane', 'Operate with evidence.', 'Inspect agent identities, immutable policies, human approvals and backend action records.'],
] as const;

export function AuthorityStory() {
  return <section className="authority-story" id="authority-story" aria-label="Authorization lifecycle">
    <div className="story-narrative">
      {chapters.map(([label, title, copy], index) => <section key={label} className="story-chapter" aria-labelledby={`chapter-${index}`}>
        <p className="eyebrow">0{index + 1} / {label}</p><h2 id={`chapter-${index}`}>{title}</h2><p>{copy}</p>
      </section>)}
      <Link to="/app/overview" className="button button-primary">Inspect the control plane</Link>
    </div>
    <div className="story-sticky"><p role="img" aria-label="Request, policy evaluation, authorization, and reconciliation">Request → Policy → Authorization → Reconciliation</p></div>
  </section>;
}
