import fs from 'node:fs'
import WDK from '@tetherto/wdk'
import WalletManagerBtc, { ElectrumTls } from '@tetherto/wdk-wallet-btc'

const WALLET_FILE = '.wallets.json'
const STATE_FILE = '.lab-state.json'
const SEND_AMOUNT = 50000n
const FEE_RATE = 2n

function satsToBtc(sats) {
  const value = BigInt(sats)
  const whole = value / 100000000n
  const fraction = (value % 100000000n).toString().padStart(8, '0')
  return `${whole}.${fraction}`
}

function loadSeeds() {
  if (!fs.existsSync(WALLET_FILE)) {
    const wallets = {
      senderSeed: WDK.getRandomSeedPhrase(),
      receiverSeed: WDK.getRandomSeedPhrase()
    }

    fs.writeFileSync(WALLET_FILE, JSON.stringify(wallets, null, 2))
    return wallets
  }

  return JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8'))
}

function createClient() {
  return new ElectrumTls({
    host: 'blackie.c3-soft.com',
    port: 57006,
    network: 'testnet'
  })
}

function printUtxos(name, utxos) {
  console.log(`\n--- UTXOs ${name} ---`)

  if (utxos.length === 0) {
    console.log('No hay UTXOs.')
    return
  }

  utxos.forEach((utxo, index) => {
    console.log(`\nUTXO #${index + 1}`)
    console.log('TXID:', utxo.tx_hash)
    console.log('VOUT:', utxo.tx_pos)
    console.log('Valor:', utxo.value, 'sats')
    console.log('BTC:', satsToBtc(utxo.value))
    console.log('Altura:', utxo.height ?? 0)
  })
}

async function main() {
  console.log('====================================')
  console.log(' LAB 04 - TRANSACCIONES BTC CON WDK')
  console.log('====================================')

  const { senderSeed, receiverSeed } = loadSeeds()

  const senderClient = createClient()
  const receiverClient = createClient()

  const senderWallet = new WalletManagerBtc(senderSeed, {
    client: senderClient,
    network: 'testnet'
  })

  const receiverWallet = new WalletManagerBtc(receiverSeed, {
    client: receiverClient,
    network: 'testnet'
  })

  try {
    const senderAccount = await senderWallet.getAccount(0)
    const receiverAccount = await receiverWallet.getAccount(0)

    const senderAddress = await senderAccount.getAddress()
    const receiverAddress = await receiverAccount.getAddress()

    console.log('\nEmisora:', senderAddress)
    console.log('Receptora:', receiverAddress)

    async function showState(title) {
      console.log(`\n========== ${title} ==========`)

      const senderBalance = await senderAccount.getBalance()
      const receiverBalance = await receiverAccount.getBalance()

      console.log('\nBalance emisora:')
      console.log(senderBalance.toString(), 'sats')
      console.log(satsToBtc(senderBalance), 'BTC')

      console.log('\nBalance receptora:')
      console.log(receiverBalance.toString(), 'sats')
      console.log(satsToBtc(receiverBalance), 'BTC')

      const senderUtxos = await senderClient.listUnspent(senderAddress)
      const receiverUtxos = await receiverClient.listUnspent(receiverAddress)

      printUtxos('EMISORA', senderUtxos)
      printUtxos('RECEPTORA', receiverUtxos)
    }

    await showState('ESTADO ACTUAL')

    const mode = process.argv[2]

    if (mode !== 'send') {
      console.log('\nConsulta completada.')
      console.log('Para realizar la transaccion ejecuta:')
      console.log('node lab04.js send')
      return
    }

    if (fs.existsSync(STATE_FILE)) {
      console.log('\nLa transaccion del laboratorio ya fue realizada.')
      console.log('No se enviaran fondos nuevamente.')
      console.log(fs.readFileSync(STATE_FILE, 'utf8'))
      return
    }

    console.log('\n========== TRANSACCION ==========')
    console.log('Destino:', receiverAddress)
    console.log('Monto:', SEND_AMOUNT.toString(), 'sats')
    console.log('Monto BTC:', satsToBtc(SEND_AMOUNT))
    console.log('Fee rate:', FEE_RATE.toString(), 'sat/vB')

    const txOptions = {
      to: receiverAddress,
      value: SEND_AMOUNT,
      feeRate: FEE_RATE
    }

    const quote = await senderAccount.quoteSendTransaction(txOptions)

    console.log('\nComision estimada:')
    console.log(quote.fee.toString(), 'sats')

    console.log('\nEnviando transaccion...')

    const result = await senderAccount.sendTransaction(
      txOptions,
      30000
    )

    console.log('\nTRANSACCION ENVIADA')
    console.log('TXID:', result.hash)
    console.log('Fee:', result.fee.toString(), 'sats')

    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({
        txid: result.hash,
        amountSats: SEND_AMOUNT.toString(),
        amountBtc: satsToBtc(SEND_AMOUNT),
        feeSats: result.fee.toString(),
        sender: senderAddress,
        receiver: receiverAddress,
        date: new Date().toISOString()
      }, null, 2)
    )

    console.log('\nEsperando actualizacion de la red...')
    await new Promise(resolve => setTimeout(resolve, 5000))

    await showState('ESTADO DESPUES DE LA TRANSACCION')
  } finally {
    senderWallet.dispose()
    receiverWallet.dispose()

    await Promise.allSettled([
      senderClient.close(),
      receiverClient.close()
    ])
  }
}

main().catch(error => {
  console.error('\nERROR:')
  console.error(error)
  process.exit(1)
})
