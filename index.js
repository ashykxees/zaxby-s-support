require('dotenv').config();

const http = require('http');

const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  ChannelType,
  OverwriteType,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const SUPPORT_ROLE_ID = process.env.SUPPORT_ROLE_ID;
const PANEL_CHANNEL_ID = process.env.PANEL_CHANNEL_ID || '1541433935475769445';
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID || '1541462926324408444';
const TRANSCRIPT_CHANNEL_ID = process.env.TRANSCRIPT_CHANNEL_ID || '1541463149872680980';

if (!DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN is required');
  process.exit(1);
}
if (!SUPPORT_ROLE_ID) {
  console.error('SUPPORT_ROLE_ID is required');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const DEPARTMENTS = [
  {
    key: 'customer_support',
    label: 'Customer Support',
    description: 'General help, account questions, how-to.',
    emoji: '💬',
  },
  {
    key: 'public_relations',
    label: 'Public Relations',
    description: 'Partnerships, press, business enquiries.',
    emoji: '🤝',
  },
  {
    key: 'trust_safety',
    label: 'Trust & Safety',
    description: 'Abuse, moderation appeals, account safety.',
    emoji: '🛡️',
  },
  {
    key: 'billing',
    label: 'Billing',
    description: 'Subscriptions, refunds, invoices.',
    emoji: '💳',
  },
];

const SLASH_COMMANDS = [
  new SlashCommandBuilder()
    .setName('close')
    .setDescription('Close this ticket channel and post a transcript.'),
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function buildPanel() {
  const embed = new EmbedBuilder()
    .setTitle('Panora Support')
    .setDescription(
      'Welcome to the Panora support desk. Our team is here to help with anything from account questions to billing to trust & safety concerns.\n\n' +
      '**How it works**\n' +
      '1. Pick the team that best matches what you need using the dropdown below.\n' +
      '2. A short form will open — tell us your case title and describe what\'s going on.\n' +
      '3. We\'ll create a private ticket channel visible only to you and the assigned team.\n' +
      '4. A staff member will claim your case and reply as soon as they\'re available.\n\n' +
      '**Before you open a case**\n' +
      '> You need a Panora account linked to your Discord — sign in at my.panora.cc if you haven\'t already.\n' +
      '> You can only have **one open case at a time**. If you\'ve already opened one on the dashboard or here, please continue there.\n' +
      '> :bell: Please don\'t ping our team members — it slows your case down and may cause it to be closed without a reply.'
    )
    .setFooter({
      text: 'Typical response times: within a few minutes during our team\'s active hours. Complex billing or moderation cases may take longer. Panora Connect · A product of Evercore Technologies Incorporated',
    })
    .setColor(0x5865f2);

  const select = new StringSelectMenuBuilder()
    .setCustomId('ticket_department_select')
    .setPlaceholder('Choose a department to open a case...')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      DEPARTMENTS.map((dept) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(dept.label)
          .setDescription(dept.description)
          .setValue(dept.key)
          .setEmoji(dept.emoji)
      )
    );

  const row = new ActionRowBuilder().addComponents(select);

  return {
    embeds: [embed],
    components: [row],
  };
}

function buildTicketModal(departmentKey) {
  const department = DEPARTMENTS.find((d) => d.key === departmentKey);
  const modal = new ModalBuilder()
    .setCustomId(`ticket_modal_${departmentKey}`)
    .setTitle(`Open ${department.label} case`);

  const titleInput = new TextInputBuilder()
    .setCustomId('ticket_title')
    .setLabel('Case title')
    .setPlaceholder('Briefly summarize your issue')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const descriptionInput = new TextInputBuilder()
    .setCustomId('ticket_description')
    .setLabel('What\'s going on?')
    .setPlaceholder('Describe your issue in detail')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(2000);

  modal.addComponents(
    new ActionRowBuilder().addComponents(titleInput),
    new ActionRowBuilder().addComponents(descriptionInput)
  );

  return modal;
}

function sanitizeChannelName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'ticket';
}

async function ensurePanel() {
  if (!PANEL_CHANNEL_ID) return;
  try {
    const channel = await client.channels.fetch(PANEL_CHANNEL_ID);
    if (!channel || channel.type !== ChannelType.GuildText) {
      console.warn('Panel channel not found or not a text channel.');
      return;
    }

    const messages = await channel.messages.fetch({ limit: 50 });
    const existing = messages.find(
      (m) => m.author.id === client.user.id && m.embeds.some((e) => e.title === 'Panora Support')
    );

    const panel = buildPanel();
    if (existing) {
      await existing.edit(panel);
      console.log(`Panel updated in ${PANEL_CHANNEL_ID}`);
    } else {
      await channel.send(panel);
      console.log(`Panel posted in ${PANEL_CHANNEL_ID}`);
    }
  } catch (err) {
    console.error('Failed to ensure panel:', err.message);
  }
}

async function fetchAllMessages(channel) {
  const allMessages = [];
  let lastId;
  while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;
    const messages = await channel.messages.fetch(options);
    if (messages.size === 0) break;
    allMessages.push(...messages.values());
    lastId = messages.last().id;
    if (messages.size < 100) break;
  }
  return allMessages.reverse();
}

function generateTranscript(messages, channel, opener, closer, department) {
  const lines = [];
  lines.push(`Ticket: ${channel.name}`);
  lines.push(`Department: ${department ? department.label : 'Unknown'}`);
  lines.push(`Opened by: ${opener ? `${opener.user.tag} (${opener.id})` : 'Unknown'}`);
  lines.push(`Closed by: ${closer ? `${closer.user.tag} (${closer.id})` : 'Unknown'}`);
  lines.push(`Created at: ${channel.createdAt ? channel.createdAt.toISOString() : 'Unknown'}`);
  lines.push(`Closed at: ${new Date().toISOString()}`);
  lines.push(`Messages: ${messages.length}`);
  lines.push('----------------------------------------');

  for (const msg of messages) {
    const timestamp = msg.createdAt ? msg.createdAt.toISOString() : 'Unknown';
    const author = msg.author ? `${msg.author.tag} (${msg.author.id})` : 'Unknown';
    let content = msg.content || '';
    if (msg.embeds && msg.embeds.length > 0) {
      content += content ? ' ' : '';
      content += `[${msg.embeds.length} embed(s)]`;
    }
    if (msg.attachments && msg.attachments.size > 0) {
      content += content ? ' ' : '';
      content += `[Attachments: ${msg.attachments.map((a) => a.url).join(', ')}]`;
    }
    lines.push(`[${timestamp}] ${author}: ${content || '[no content]'}`);
  }

  return lines.join('\n');
}

async function closeTicket(channel, member) {
  if (!channel.isTextBased()) return;

  const guild = channel.guild;
  const supportRole = await guild.roles.fetch(SUPPORT_ROLE_ID).catch(() => null);

  let opener;
  const openerOverwrite = channel.permissionOverwrites.cache.find(
    (overwrite) => overwrite.type === OverwriteType.Member && overwrite.allow.has(PermissionFlagsBits.ViewChannel)
  );
  if (openerOverwrite) {
    opener = await guild.members.fetch(openerOverwrite.id).catch(() => null);
  }

  const topicParts = (channel.topic || '').split(' | ');
  const departmentKey = topicParts[0] || '';
  const title = topicParts[1] || '';
  const department = DEPARTMENTS.find((d) => d.key === departmentKey);

  const messages = await fetchAllMessages(channel);
  const transcriptText = generateTranscript(messages, channel, opener, member, department);
  const buffer = Buffer.from(transcriptText, 'utf8');
  const attachment = new AttachmentBuilder(buffer, { name: `${channel.name}-transcript.txt` });

  const transcriptChannel = await client.channels.fetch(TRANSCRIPT_CHANNEL_ID).catch(() => null);
  if (transcriptChannel && transcriptChannel.isTextBased()) {
    const embed = new EmbedBuilder()
      .setTitle(`Ticket closed: ${title || channel.name}`)
      .setDescription(
        `**Department:** ${department ? department.label : 'Unknown'}\n` +
        `**Opened by:** ${opener ? `<@${opener.id}>` : 'Unknown'}\n` +
        `**Closed by:** ${member ? `<@${member.id}>` : 'Unknown'}\n` +
        `**Messages:** ${messages.length}`
      )
      .setColor(0x5865f2)
      .setTimestamp();

    await transcriptChannel.send({
      embeds: [embed],
      files: [attachment],
    });
  }

  await channel.delete(`Ticket closed by ${member ? member.user.tag : 'unknown'}`);
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), {
        body: SLASH_COMMANDS.map((cmd) => cmd.toJSON()),
      });
      console.log(`Registered guild commands for ${GUILD_ID}`);
    } else {
      await rest.put(Routes.applicationCommands(client.user.id), {
        body: SLASH_COMMANDS.map((cmd) => cmd.toJSON()),
      });
      console.log('Registered global commands');
    }
  } catch (err) {
    console.error('Failed to register commands:', err.message);
  }

  await ensurePanel();
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'ticket_department_select') {
        const departmentKey = interaction.values[0];
        const modal = buildTicketModal(departmentKey);
        await interaction.showModal(modal);
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      if (!interaction.customId.startsWith('ticket_modal_')) return;
      const departmentKey = interaction.customId.replace('ticket_modal_', '');
      const department = DEPARTMENTS.find((d) => d.key === departmentKey);
      const title = interaction.fields.getTextInputValue('ticket_title').trim();
      const description = interaction.fields.getTextInputValue('ticket_description').trim();

      await interaction.deferReply({ ephemeral: true });

      const guild = interaction.guild;
      const member = interaction.member;

      const supportRole = await guild.roles.fetch(SUPPORT_ROLE_ID).catch(() => null);
      const category = await guild.channels.fetch(TICKET_CATEGORY_ID).catch(() => null);

      if (!category || category.type !== ChannelType.GuildCategory) {
        await interaction.editReply({ content: 'Ticket category is not configured correctly. Please contact an admin.' });
        return;
      }

      const baseName = sanitizeChannelName(`${member.user.username}-${department.label}`);
      const channelName = `${baseName}`;

      const permissionOverwrites = [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: member.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
          ],
        },
      ];

      if (supportRole) {
        permissionOverwrites.push({
          id: supportRole.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
          ],
        });
      }

      const ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: `${departmentKey} | ${title}`,
        permissionOverwrites,
      });

      const welcomeEmbed = new EmbedBuilder()
        .setTitle(`New case: ${title}`)
        .setDescription(
          `**Department:** ${department.label}\n` +
          `**Opened by:** ${member.user.tag} (<@${member.id}>)\n\n` +
          `**Description:**\n${description}`
        )
        .setColor(0x5865f2)
        .setTimestamp();

      const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_close_button')
          .setLabel('Close ticket')
          .setStyle(ButtonStyle.Danger)
      );

      await ticketChannel.send({
        content: `<@${member.id}> ${supportRole ? `<@&${supportRole.id}>` : ''}`.trim(),
        embeds: [welcomeEmbed],
        components: [closeRow],
        allowedMentions: { users: [member.id], roles: supportRole ? [supportRole.id] : [] },
      });

      await interaction.editReply({
        content: `Your case has been opened in <#${ticketChannel.id}>. A staff member will be with you shortly.`,
      });
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'ticket_close_button') {
        await interaction.deferReply({ ephemeral: true });
        const member = interaction.member;
        const channel = interaction.channel;

        const supportRole = await interaction.guild.roles.fetch(SUPPORT_ROLE_ID).catch(() => null);
        const isSupport = supportRole && member.roles.cache.has(supportRole.id);

        const openerOverwrite = channel.permissionOverwrites.cache.find(
          (overwrite) =>
            overwrite.type === OverwriteType.Member && overwrite.allow.has(PermissionFlagsBits.ViewChannel)
        );
        const isOpener = openerOverwrite && openerOverwrite.id === member.id;

        if (!isSupport && !isOpener && !member.permissions.has(PermissionFlagsBits.Administrator)) {
          await interaction.editReply({ content: 'You do not have permission to close this ticket.' });
          return;
        }

        await interaction.editReply({ content: 'Closing ticket and posting transcript...' });
        await closeTicket(channel, member);
      }
      return;
    }

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'close') {
        const channel = interaction.channel;
        if (!channel || !channel.isTextBased() || channel.type === ChannelType.DM) {
          await interaction.reply({ content: 'This command can only be used in a ticket channel.', ephemeral: true });
          return;
        }

        const member = interaction.member;
        const guild = interaction.guild;
        const supportRole = await guild.roles.fetch(SUPPORT_ROLE_ID).catch(() => null);
        const isSupport = supportRole && member.roles.cache.has(supportRole.id);

        const openerOverwrite = channel.permissionOverwrites.cache.find(
          (overwrite) =>
            overwrite.type === OverwriteType.Member && overwrite.allow.has(PermissionFlagsBits.ViewChannel)
        );
        const isOpener = openerOverwrite && openerOverwrite.id === member.id;

        if (!isSupport && !isOpener && !member.permissions.has(PermissionFlagsBits.Administrator)) {
          await interaction.reply({ content: 'You do not have permission to close this ticket.', ephemeral: true });
          return;
        }

        await interaction.reply({ content: 'Closing ticket and posting transcript...', ephemeral: true });
        await closeTicket(channel, member);
      }
      return;
    }
  } catch (err) {
    console.error('Interaction error:', err);
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ content: 'Something went wrong. Please try again.' });
      } else {
        await interaction.reply({ content: 'Something went wrong. Please try again.', ephemeral: true });
      }
    } catch (replyErr) {
      console.error('Failed to reply to interaction:', replyErr.message);
    }
  }
});

client.login(DISCORD_TOKEN).catch((err) => {
  console.error('Discord login failed:', err.message);
});

// Minimal health endpoint for Railway / Render / container hosts
const port = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Zaxby Support is running');
  })
  .listen(port, () => console.log(`Health server listening on port ${port}`));
