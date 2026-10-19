import { Server } from 'lucide-react';
import MailServer from './MailServer';

/*
 * Mail server: its own page (#/ext/mail-server) and the tab "Mail server" in Hostwerk's mail area (slot "mail.tabs",
 * same address #/mail/server as before). Status dots in the sidebar come from the overview of the mail area.
 */
function MailServerPage({ path = [] }) {
  return (
    <div className="page fade-in">
      <div className="page-head">
        <div>
          <h1><Server /> Mail server</h1>
          <p>Real mailboxes for your domain – Stalwart or Apache James, set up and maintained by Hostwerk.</p>
        </div>
      </div>
      <MailServer id={path[0]} base="/ext/mail-server" />
    </div>
  );
}

function MailTab({ sub }) { return <MailServer id={sub} base="/mail/server" />; }

export default {
  pages: { main: MailServerPage },
  slots: { 'mail.tabs': [{ id: 'server', title: 'Mail server', icon: Server, Component: MailTab, order: 20 }] },
};
